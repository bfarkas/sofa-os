// Phone Remote (Session 18). The keys Companion may send and the Samsung key code each one forwards.
// The write guard in server/src/ha.ts allows exactly these codes. Power, source and channel keys are left out on purpose: the
// Watch Allowance owns power. Volume and mute were added 2026-11-11 (the user's decision, Session 33).
export const REMOTE_KEYS = {
  up: 'KEY_UP',
  down: 'KEY_DOWN',
  left: 'KEY_LEFT',
  right: 'KEY_RIGHT',
  ok: 'KEY_ENTER',
  back: 'KEY_RETURN',
  home: 'KEY_HOME',
  play: 'KEY_PLAY',
  pause: 'KEY_PAUSE',
  stop: 'KEY_STOP',
  rewind: 'KEY_REWIND',
  forward: 'KEY_FF',
  volup: 'KEY_VOLUP',
  voldown: 'KEY_VOLDOWN',
  mute: 'KEY_MUTE',
} as const;

export type RemoteKey = keyof typeof REMOTE_KEYS;
/** `menu` is not a TV key: the Server signals Sofa Home over its WebSocket instead. */
export type PhoneKey = RemoteKey | 'menu';

export const isPhoneKey = (key: unknown): key is PhoneKey => key === 'menu' || (typeof key === 'string' && Object.hasOwn(REMOTE_KEYS, key));

/** Body of POST /api/remote. */
export interface RemoteRequest {
  key: PhoneKey;
}

/** What Sofa Home sends over its WebSocket: whether its page is in front, so Menu knows if it has a target. */
export interface TvMessage {
  type: 'visible';
  visible: boolean;
}
