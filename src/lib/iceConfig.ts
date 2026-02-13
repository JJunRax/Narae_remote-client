/**
 * ICE (Interactive Connectivity Establishment) Server Configuration
 *
 * STUN servers help discover public IP addresses behind NAT
 * TURN servers relay traffic when direct P2P connection fails
 */

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Free public STUN/TURN servers
 *
 * Production: Replace with your own TURN server (Twilio, Cloudflare, etc.)
 * These public servers may have rate limits or availability issues
 */
export const ICE_SERVERS: IceServer[] = [
  // Google STUN servers (free, reliable)
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },

  // Additional STUN servers for redundancy
  { urls: "stun:stun.stunprotocol.org:3478" },

  // Free public TURN servers (limited reliability, use for testing only)
  // For production, set up your own TURN server or use a service:
  // - Twilio: https://www.twilio.com/stun-turn
  // - Cloudflare: https://developers.cloudflare.com/calls/turn/
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

/**
 * ICE configuration for RTCPeerConnection
 */
export const ICE_CONFIG = {
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 10, // Pre-gather ICE candidates for faster connection
  iceTransportPolicy: "all" as RTCIceTransportPolicy, // Try all connection types
};

/**
 * Get TURN credentials from API (for production use)
 * This should fetch temporary credentials from your backend
 */
export async function getTurnCredentials(): Promise<IceServer[]> {
  try {
    // TODO: Implement API call to get temporary TURN credentials
    // Example for Twilio:
    // const response = await fetch('/api/turn/credentials');
    // const data = await response.json();
    // return data.iceServers;

    return ICE_SERVERS;
  } catch (error) {
    console.warn("Failed to get TURN credentials, using fallback:", error);
    return ICE_SERVERS;
  }
}
