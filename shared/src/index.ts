// Types and constants shared by the Server, Companion and Sofa Home.
// Session 05 adds the layout schema and visual tokens here.

export interface LoginRequest {
  password: string;
}

export interface SessionInfo {
  signedIn: true;
  expiresAt: string; // ISO time
}

export interface ApiError {
  error: string;
}

/** Messages the Server sends over the WebSocket. */
export type ServerMessage = { type: 'hello'; serverTime: string };
