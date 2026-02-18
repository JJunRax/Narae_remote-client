import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import "./App.css";
import { db } from "./lib/firebase";
import { collection, addDoc, onSnapshot, doc, deleteDoc, query, where, getDocs, Timestamp, updateDoc, arrayUnion } from "firebase/firestore";
// @ts-ignore
import SimplePeer from "simple-peer";
import { validateCommand } from "./lib/commandValidator";
import { ICE_CONFIG } from "./lib/iceConfig";

function generateSessionCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

type AppStatus = "idle" | "preparing" | "waiting" | "connected" | "error" | "ended";

function App() {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<AppStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("원격 지원을 준비하고 있습니다...");
  const [copied, setCopied] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionDocId = useRef<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const logDocId = useRef<string | null>(null);
  const commandCounts = useRef({ mouseMovements: 0, mouseClicks: 0, keyPresses: 0 });
  const connectedAtRef = useRef<Date | null>(null);
  const autoStarted = useRef(false);

  const writeEndLog = useCallback(async (endReason: string) => {
    if (!logDocId.current) return;
    try {
      const now = new Date();
      const duration = connectedAtRef.current
        ? Math.floor((now.getTime() - connectedAtRef.current.getTime()) / 1000)
        : 0;
      await updateDoc(doc(db, "remote_session_logs", logDocId.current), {
        endedAt: Timestamp.fromDate(now),
        duration,
        commandSummary: { ...commandCounts.current },
        endReason,
      });
    } catch (e) {
      console.error("Log update error:", e);
    }
    logDocId.current = null;
    connectedAtRef.current = null;
    commandCounts.current = { mouseMovements: 0, mouseClicks: 0, keyPresses: 0 };
  }, []);

  const cleanup = useCallback(async (endReason?: string) => {
    if (endReason) {
      await writeEndLog(endReason);
    }
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
    if (sessionDocId.current) {
      try {
        await deleteDoc(doc(db, "remote_sessions", sessionDocId.current));
      } catch (e) {
        console.error("Session cleanup error:", e);
      }
      sessionDocId.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCode("");
  }, [writeEndLog]);

  const stopSession = useCallback(async () => {
    await cleanup("client_disconnect");
    setStatus("ended");
    setStatusMessage("원격 지원이 종료되었습니다.");
  }, [cleanup]);

  const startShare = useCallback(async () => {
    if (status === "preparing" || status === "waiting" || status === "connected") return;

    setStatus("preparing");
    setStatusMessage("화면 공유 준비 중...");

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: "always",
          width: { ideal: 1920, max: 2560 },
          height: { ideal: 1080, max: 1440 },
          frameRate: { ideal: 30, max: 60 }
        } as any,
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      const peer = new SimplePeer({
        initiator: true,
        trickle: true,
        stream: stream,
        config: ICE_CONFIG,
      });
      peerRef.current = peer;

      let answerSignaled = false;
      let processedAnswerCandidates = 0;

      // Set initial bitrate constraint
      peer.on("connect", async () => {
        try {
          const senders = (peer as any)._pc.getSenders();
          const videoSender = senders.find((s: RTCRtpSender) => s.track?.kind === 'video');
          if (videoSender) {
            const parameters = videoSender.getParameters();
            if (!parameters.encodings) {
              parameters.encodings = [{}];
            }
            parameters.encodings[0].maxBitrate = 2500000;
            await videoSender.setParameters(parameters);
          }
        } catch (err) {
          console.warn("Failed to set bitrate:", err);
        }
      });

      peer.on("signal", async (data: any) => {
        if (data.type === "offer") {
          // SDP offer — create Firestore session
          let sessionCode = generateSessionCode();
          const sessionsRef = collection(db, "remote_sessions");
          const existing = await getDocs(query(sessionsRef, where("sessionCode", "==", sessionCode), where("status", "==", "waiting")));
          if (!existing.empty) {
            sessionCode = generateSessionCode();
          }

          const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
          const docRef = await addDoc(sessionsRef, {
            sessionCode,
            offer: JSON.stringify(data),
            offerCandidates: [],
            answer: "",
            answerCandidates: [],
            status: "waiting",
            createdAt: Timestamp.fromDate(new Date()),
            expiresAt: Timestamp.fromDate(expiresAt),
          });
          sessionDocId.current = docRef.id;
          setCode(sessionCode);
          setStatus("waiting");
          setStatusMessage("상담원의 연결을 대기하고 있습니다...");
          console.log("✅ Session created:", sessionCode);

          const logRef = await addDoc(collection(db, "remote_session_logs"), {
            sessionCode,
            sessionDocId: docRef.id,
            startedAt: Timestamp.fromDate(new Date()),
            connectedAt: null,
            endedAt: null,
            duration: 0,
            commandSummary: { mouseMovements: 0, mouseClicks: 0, keyPresses: 0 },
            endReason: null,
          });
          logDocId.current = logRef.id;

          // Listen for answer + answerCandidates
          const unsub = onSnapshot(doc(db, "remote_sessions", docRef.id), (snapshot) => {
            const snapData = snapshot.data();
            if (!snapData) return;

            // Signal answer SDP (once)
            if (snapData.answer && !answerSignaled) {
              answerSignaled = true;
              console.log("🔗 Received answer from admin");
              peer.signal(JSON.parse(snapData.answer));
            }

            // Signal new answer candidates
            const candidates = snapData.answerCandidates || [];
            for (let i = processedAnswerCandidates; i < candidates.length; i++) {
              console.log("🧊 Received answer candidate", i);
              peer.signal(JSON.parse(candidates[i]));
            }
            processedAnswerCandidates = candidates.length;
          });
          unsubRef.current = unsub;
        } else if (data.candidate && sessionDocId.current) {
          // ICE candidate — append to offerCandidates
          console.log("🧊 Sending offer candidate");
          await updateDoc(doc(db, "remote_sessions", sessionDocId.current), {
            offerCandidates: arrayUnion(JSON.stringify(data)),
          }).catch(err => console.error("Failed to send candidate:", err));
        }
      });

      peer.on("connect", async () => {
        connectedAtRef.current = new Date();
        setStatus("connected");
        setStatusMessage("상담원과 연결되었습니다.");
        console.log("✅ Peer connected!");
        if (logDocId.current) {
          try {
            await updateDoc(doc(db, "remote_session_logs", logDocId.current), {
              connectedAt: Timestamp.fromDate(new Date()),
            });
          } catch (e) {
            console.error("Log connect update error:", e);
          }
        }

        // Adaptive bitrate monitoring
        const bitrateMonitor = setInterval(async () => {
          try {
            const pc = (peer as any)._pc as RTCPeerConnection;
            if (!pc || pc.connectionState !== 'connected') {
              clearInterval(bitrateMonitor);
              return;
            }

            const stats = await pc.getStats();
            let packetLoss = 0;
            let totalPackets = 0;

            stats.forEach((report: any) => {
              if (report.type === 'outbound-rtp' && report.kind === 'video') {
                const packetsLost = report.packetsLost || 0;
                const packetsSent = report.packetsSent || 0;
                totalPackets = packetsSent;
                packetLoss = totalPackets > 0 ? packetsLost / totalPackets : 0;
              }
            });

            const senders = pc.getSenders();
            const videoSender = senders.find((s: RTCRtpSender) => s.track?.kind === 'video');

            if (videoSender && totalPackets > 100) {
              const parameters = videoSender.getParameters();
              if (!parameters.encodings) {
                parameters.encodings = [{}];
              }

              const currentBitrate = parameters.encodings[0].maxBitrate || 2500000;
              let newBitrate = currentBitrate;

              if (packetLoss > 0.05) {
                newBitrate = Math.max(500000, currentBitrate * 0.8);
              } else if (packetLoss < 0.01 && currentBitrate < 4000000) {
                newBitrate = Math.min(4000000, currentBitrate * 1.1);
              }

              if (newBitrate !== currentBitrate) {
                parameters.encodings[0].maxBitrate = newBitrate;
                await videoSender.setParameters(parameters);
              }
            }
          } catch (err) {
            console.warn("Bitrate monitoring error:", err);
          }
        }, 3000);

        peer.once("close", () => clearInterval(bitrateMonitor));
      });

      peer.on("data", async (rawData: any) => {
        try {
          const parsed = JSON.parse(rawData.toString());
          const command = validateCommand(parsed);
          if (!command) return;

          if (command.type === "mousemove") {
            commandCounts.current.mouseMovements++;
            await invoke("mouse_move", { cmd: command });
          } else if (command.type === "mousedown" || command.type === "mouseup" || command.type === "click") {
            commandCounts.current.mouseClicks++;
            await invoke("mouse_click", { cmd: { button: command.button ?? 0, action: command.type === "mousedown" ? "down" : command.type === "mouseup" ? "up" : "click" } });
          } else if (command.type === "keydown" || command.type === "keyup") {
            commandCounts.current.keyPresses++;
            await invoke("key_input", { cmd: { key: command.key, action: command.type === "keydown" ? "down" : "up" } });
          }
        } catch (err) {
          console.error("Command execution error:", err);
        }
      });

      peer.on("error", (err: any) => {
        console.error("Peer error:", err);
        setStatus("error");
        setStatusMessage("연결 오류가 발생했습니다: " + err.message);
      });

      peer.on("close", async () => {
        await cleanup("admin_disconnect");
        setStatus("ended");
        setStatusMessage("상담원과의 연결이 종료되었습니다.");
      });

      stream.getVideoTracks()[0].onended = async () => {
        await cleanup("client_disconnect");
        setStatus("ended");
        setStatusMessage("화면 공유가 중단되었습니다.");
      };
    } catch (err: any) {
      console.error(err);
      if (err.name === "NotAllowedError") {
        setStatus("idle");
        setStatusMessage("화면 공유가 취소되었습니다. 아래 버튼을 눌러 다시 시도해주세요.");
      } else {
        setStatus("error");
        setStatusMessage("오류 발생: " + String(err));
      }
    }
  }, [status, cleanup]);

  const copyCode = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Auto-start on mount
  useEffect(() => {
    if (!autoStarted.current) {
      autoStarted.current = true;
      const timer = setTimeout(() => {
        startShare();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []);

  // Listen for deep-link events (when app is already running)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onOpenUrl((urls) => {
      console.log("Deep link received:", urls);
      if (status === "idle" || status === "ended" || status === "error") {
        startShare();
      }
    }).then((fn) => {
      unlisten = fn;
    }).catch((err) => {
      console.warn("Deep link listener setup failed:", err);
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [status, startShare]);

  // Apply stream to video when video element becomes available
  useEffect(() => {
    if ((status === "waiting" || status === "connected") && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [status]);

  const statusDotClass =
    status === "waiting" ? "waiting" :
    status === "connected" ? "connected" :
    status === "error" ? "error" : "";

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <div className="logo-area">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="14" x="2" y="3" rx="2" />
            <line x1="8" x2="16" y1="21" y2="21" />
            <line x1="12" x2="12" y1="17" y2="21" />
          </svg>
        </div>
        <h1>나래소프트 원격 지원</h1>
        <p>안전한 화면 공유로 빠르게 도와드립니다</p>
      </div>

      {/* Main Content */}
      {status === "connected" ? (
        <div className="connected-card">
          <div className="connected-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#34c759" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h2><span className="pulse-dot" />원격 지원 진행 중</h2>
          <p>상담원이 화면을 보고 있습니다</p>
          <button className="btn-danger" onClick={stopSession}>
            지원 종료
          </button>
        </div>
      ) : (
        <div className="card">
          {status === "idle" ? (
            <button className="btn-primary" onClick={startShare}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect width="20" height="14" x="2" y="3" rx="2" />
                <line x1="8" x2="16" y1="21" y2="21" />
                <line x1="12" x2="12" y1="17" y2="21" />
              </svg>
              화면 공유 시작
            </button>
          ) : status === "error" ? (
            <>
              <div className="error-text">{statusMessage}</div>
              <button className="btn-primary" onClick={startShare}>
                다시 시도
              </button>
            </>
          ) : status === "preparing" ? (
            <button className="btn-primary" disabled>
              <div className="spinner" />
              화면 선택 중...
            </button>
          ) : status === "waiting" ? (
            <>
              <button className="btn-primary" disabled>
                <div className="spinner" />
                상담원 대기 중
              </button>
              {code && (
                <div className="code-section">
                  <p>아래 코드를 상담원에게 알려주세요</p>
                  <div className="code-value">{code}</div>
                  <button className="btn-copy" onClick={copyCode}>
                    {copied ? (
                      <>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        복사됨
                      </>
                    ) : (
                      <>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
                        코드 복사
                      </>
                    )}
                  </button>
                </div>
              )}
              <button className="btn-danger" onClick={stopSession}>
                취소
              </button>
            </>
          ) : status === "ended" ? (
            <>
              <div className="ended-message">{statusMessage}</div>
              <button className="btn-primary" onClick={startShare}>
                다시 시작
              </button>
            </>
          ) : null}
        </div>
      )}

      {/* Status Bar */}
      {status !== "idle" && status !== "ended" && status !== "error" && (
        <div className="status-bar">
          <span className={`status-dot ${statusDotClass}`} />
          {statusMessage}
        </div>
      )}

      {/* Preview video */}
      {(status === "waiting" || status === "connected") && (
        <video ref={videoRef} autoPlay playsInline muted className="preview-video" />
      )}

      <div className="footer-brand">Naraesoft Remote Support</div>
    </div>
  );
}

export default App;
