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
