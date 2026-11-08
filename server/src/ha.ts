import type { HaConfig } from './config.ts';

// Home Assistant client. Every service call passes the write guard, which allows exactly the
// spec's three writes (Home Assistant and household information) and refuses everything else.
// A new write needs a spec decision first, then a rule here and a test.

export interface ServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
}

export class WriteRefused extends Error {}

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
    if (!res.ok) throw new Error(`Home Assistant ${init?.method ?? 'GET'} ${path}: HTTP ${res.status}`);
    return res.json();
  }

  async function callService(call: ServiceCall): Promise<unknown> {
    checkWrite(call, ha);
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
