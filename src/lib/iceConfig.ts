/**
 * ICE (Interactive Connectivity Establishment) Server Configuration
 */

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * STUN servers for NAT traversal
 * For production TURN, configure Twilio/Cloudflare in the admin API
 */
export const ICE_SERVERS: IceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

export const ICE_CONFIG = {
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 10,
  iceTransportPolicy: "all" as RTCIceTransportPolicy,
};
