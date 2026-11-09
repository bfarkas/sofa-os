import WebSocket from 'ws';
import type { HaConfig } from './config.ts';
import { log } from './log.ts';

// Home Assistant client. Every service call passes the write guard, which allows exactly the
// spec's three writes (Home Assistant and household information) and refuses everything else.
// A new write needs a spec decision first, then a rule here and a test.

export interface ServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
}

export class WriteRefused extends Error {}
/** A Home Assistant answer that was not OK; the status lets a reader tell a missing entity (404) from an outage. */
export class HaHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const KEY = /^KEY_[A-Z0-9_]+$/;
const ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;

function onlyKeys(data: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(data).every((k) => allowed.includes(k));
}

/** Throws WriteRefused unless the call is one of the three allowed writes, aimed at this TV or the adults' phones. */
export function checkWrite(call: ServiceCall, ha: HaConfig): void {
  const { domain, service, data } = call;
  const name = `${domain}.${service}`;
  // 1. Turn this TV off when the Watch Allowance reaches zero.
  if (name === 'media_player.turn_off' && onlyKeys(data, ['entity_id']) && data.entity_id === ha.tvEntity) return;
  // 2. Send the Watch Allowance notification to the adults' phones.
  if (domain === 'notify' && ha.notifyServices.includes(service) && onlyKeys(data, ['message', 'title', 'data']) && typeof data.message === 'string') return;
  // 3. Forward Phone Remote keys to this TV.
  if (name === 'remote.send_command' && onlyKeys(data, ['entity_id', 'command']) && data.entity_id === ha.remoteEntity) {
    const cmd = data.command;
    if ((typeof cmd === 'string' && KEY.test(cmd)) || (Array.isArray(cmd) && cmd.length > 0 && cmd.every((c) => typeof c === 'string' && KEY.test(c)))) return;
  }
  throw new WriteRefused(`Home Assistant write refused: ${name} ${JSON.stringify(data)}`);
}

export type HaClient = ReturnType<typeof createHaClient>;

export function createHaClient(ha: HaConfig, fetchFn: typeof fetch = fetch) {
  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetchFn(ha.url + path, {
      ...init,
      headers: { Authorization: `Bearer ${ha.token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new HaHttpError(`Home Assistant ${init?.method ?? 'GET'} ${path}: HTTP ${res.status}`, res.status);
    return res.json();
  }

  async function callService(call: ServiceCall): Promise<unknown> {
    checkWrite(call, ha);
    if (ha.dryRun) {
      log.info('home assistant dry run', { service: `${call.domain}.${call.service}`, data: call.data });
      return null;
    }
    return request(`/api/services/${call.domain}/${call.service}`, { method: 'POST', body: JSON.stringify(call.data) });
  }

  return {
    callService,
    getState(entityId: string): Promise<unknown> {
      if (!ENTITY.test(entityId)) throw new Error(`not an entity id: ${entityId}`);
      return request(`/api/states/${entityId}`);
    },
    turnOffTv: () => callService({ domain: 'media_player', service: 'turn_off', data: { entity_id: ha.tvEntity } }),
    notifyAdults: (message: string, extra: { title?: string; data?: Record<string, unknown> } = {}) =>
      Promise.all(ha.notifyServices.map((service) => callService({ domain: 'notify', service, data: { message, ...extra } }))),
    sendKey: (key: string) => callService({ domain: 'remote', service: 'send_command', data: { entity_id: ha.remoteEntity, command: key } }),
  };
}

/**
 * Listens for one Home Assistant event type over its WebSocket API and reconnects after a drop. Read-only: it sends
 * nothing but auth and subscribe_events, so no write can get past the guard this way. Events during a drop are lost.
 */
export function subscribeEvents(ha: HaConfig, eventType: string, onEvent: (data: Record<string, unknown>) => void, retryMs = 5000): () => void {
  let ws: WebSocket;
  let stopped = false;
  let down = false; // log a drop once, not on every retry
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    ws = new WebSocket(ha.url.replace(/^http/, 'ws') + '/api/websocket', { handshakeTimeout: 10_000 });
    let alive = true;
    let beat: ReturnType<typeof setInterval> | undefined;
    ws.on('open', () => {
      // A connection that dies without a close (a host gone from the LAN) would otherwise wait forever.
      beat = setInterval(() => (alive ? ((alive = false), ws.ping()) : ws.terminate()), 30_000);
    });
    ws.on('pong', () => (alive = true));
    ws.on('message', (raw) => {
      let msg: { type?: string; success?: boolean; error?: unknown; event?: { event_type?: string; data?: Record<string, unknown> } };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: ha.token }));
      else if (msg.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: eventType }));
      else if (msg.type === 'auth_invalid') log.warn('home assistant refused the token', { eventType });
      else if (msg.type === 'result') {
        if (msg.success) log.info('home assistant events subscribed', { eventType });
        else log.warn('home assistant subscription failed', { eventType, error: msg.error });
        down = false;
      } else if (msg.type === 'event' && msg.event?.event_type === eventType) onEvent(msg.event.data ?? {});
    });
    ws.on('error', () => {}); // a close follows
    ws.on('close', () => {
      clearInterval(beat);
      if (stopped) return;
      if (!down) log.warn('home assistant events disconnected, retrying', { eventType });
      down = true;
      retry = setTimeout(connect, retryMs);
    });
  };
  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    ws.close();
  };
}
