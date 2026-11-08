// Types and constants shared by the Server, Companion and Sofa Home.
export * from './layout.ts';

export interface LoginRequest {
  password: string;
}

export interface SessionInfo {
  signedIn: true;
  expiresAt: string; // ISO time
}

export interface ApiError {
  error: string;
  errors?: string[]; // validation problems, from a refused publish
}

/** A Companion draft. `base` is the revision it was started from; publishing is refused unless it is still current. */
export interface Draft {
  id: number;
  base: number;
  layout: unknown; // saved as sent, so a half-finished edit survives
  errors: string[]; // validateLayout(layout)
}

/** Body of PUT /api/drafts/:id. `base` must match the draft's, so an edit never overwrites a rebased draft. */
export interface DraftUpdate {
  base: number;
  layout: unknown;
}

/** Messages the Server sends over the WebSocket. */
export type ServerMessage =
  | { type: 'hello'; serverTime: string }
  | { type: 'revision'; revision: number }; // a new revision is published: fetch GET /api/snapshot

// TV Sign-in (spec: TV Sign-in). The TV keeps `secret`; only `code` goes into the QR code and the approval URL.
export interface TvCode {
  code: string; // 8 characters, shown on the TV and carried by the QR code
  secret: string; // never leaves the TV; the Server stores only its hash
  expiresAt: string; // ISO time
}

export interface TvTokenRequest {
  code: string;
  secret: string;
}

/** Answer to POST /api/tv/token. The token is delivered once, to the holder of the code's secret. */
export type TvTokenResponse = { status: 'pending' } | { status: 'approved'; token: string };

export interface TvApproveRequest {
  code: string;
}

/** Browsers cannot set headers on a WebSocket, so Sofa Home sends its device token as `sofa-token.<token>` in Sec-WebSocket-Protocol. */
export const TV_PROTOCOL_PREFIX = 'sofa-token.';
