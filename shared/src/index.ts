// Types and constants shared by the Server, Companion and Sofa Home.
export * from './daycycle.ts';
export * from './layout.ts';
export * from './ops.ts';
export * from './photos.ts';
export * from './remote.ts';
export * from './tokens.ts';
export * from './widgets.ts';

export interface LoginRequest {
  password: string;
}

export interface SessionInfo {
  signedIn: true;
  expiresAt: string; // ISO time
}

/** GET /api/system, for Companion's status banner. */
export interface SystemStatus {
  homeAssistant: 'on' | 'dry run' | 'off'; // off: no token configured, not an outage
  haReachable: boolean | null; // null: not known yet, or off
  haSince: string | null; // ISO time the reachability last changed
  backup: { lastAt: string | null; lastError: string | null };
}

export interface ApiError {
  error: string;
  errors?: string[]; // validation problems, from a refused publish
  triesLeft?: number; // a wrong Kids Mode PIN: tries before the lockout
  retryAfterSeconds?: number; // a locked-out PIN: when to try again
}

/** A Companion draft. `base` is the revision it builds on (moved forward by Sofa Home's operations); publishing is refused unless it is still current. */
export interface Draft {
  id: number;
  base: number;
  layout: unknown; // saved as sent, so a half-finished edit survives
  errors: string[]; // validateLayout(layout)
}

/**
 * Body of PUT /api/drafts/:id. `base` is the draft's, or an earlier revision followed only by Sofa Home's operations, which the
 * Server replays onto `layout` (ADR 0004); the answer is the merged draft. Any other base is refused with 409.
 */
export interface DraftUpdate {
  base: number;
  layout: unknown;
}

/** Messages the Server sends over the WebSocket. */
export type ServerMessage =
  | { type: 'hello'; serverTime: string }
  | { type: 'revision'; revision: number } // a new revision is published: fetch GET /api/snapshot
  | { type: 'kids' } // Kids Mode or the Watch Allowance changed (enter, exit, Top-up, zero, reset): fetch GET /api/kids
  | { type: 'widgets' } // widget data changed: fetch GET /api/widgets
  | { type: 'menu' }; // Phone Remote Menu: open the focused widget's context menu

/** The Watch Allowance as GET /api/kids returns it. All times are whole seconds. */
export interface KidsStatus {
  active: boolean; // Kids Mode is on
  tv: 'on' | 'off' | 'pending'; // the Server's view of the TV; pending is an unconfirmed on, which does not count yet
  dailySeconds: number; // the layout's kidsMode.dailyMinutes
  topUpSeconds: number; // Top-ups added today
  usedSeconds: number; // counted today
  remainingSeconds: number; // 0 means the allowance has run out
  donePending: boolean; // the TV was switched off at zero: show the Done Screen, then POST /api/kids/done-shown
  resetsAt: string; // ISO time of the next overnight reset
  pinSet: boolean; // an adult has set the Kids Mode PIN; the TV cannot leave Kids Mode without one
}

/** The Kids Mode PIN: exactly four digits, so the TV's pad needs no OK key. */
export const PIN_PATTERN = /^\d{4}$/;

/** Body of PUT /api/kids/pin (Companion only). */
export interface KidsPinRequest {
  pin: string;
}

/** Body of POST /api/kids/exit. Sofa Home must send the PIN; a Companion session needs none. */
export interface KidsExitRequest {
  pin?: string;
}

/** The Kids Mode notification's tap target and tag, and where Companion shows the Top-up page. */
export const KIDS_TOPUP_PATH = '/kids/topup';

/** Body of POST /api/kids/topup (Companion only). */
export interface TopUpRequest {
  minutes: number; // whole minutes, 1 to 240
}

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
