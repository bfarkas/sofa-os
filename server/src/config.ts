import { readFileSync } from 'node:fs';

export interface HaConfig {
  url: string;
  token: string;
  tvEntity: string; // media_player.* for this TV
  remoteEntity: string; // remote.* for this TV
  notifyServices: string[]; // notify.* services of the adults' phones, without the "notify." prefix
  dryRun?: boolean; // writes pass the guard and are logged, not sent
}

export interface AllowanceConfig {
  timeZone: string; // the household's, for the overnight reset
  resetMinutes: number; // the overnight reset, in minutes after local midnight
  graceSeconds: number; // between zero and the switch-off
}

export interface Config {
  port: number;
  dbPath: string;
  mediaDir: string;
  companionDir: string;
  passwordHash: string;
  secureCookies: boolean;
  ha: HaConfig | null; // null until a Home Assistant token is configured
  allowance: AllowanceConfig;
}

type Env = Record<string, string | undefined>;

// FOO_FILE wins over FOO, so secrets can come from Docker secret files.
function secret(env: Env, name: string): string | undefined {
  const file = env[name + '_FILE'];
  return file ? readFileSync(file, 'utf8').trim() : env[name];
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`missing configuration: ${name}`);
  return value;
}

function clockTime(value: string, name: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) throw new Error(`${name} must be HH:MM, got ${JSON.stringify(value)}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function wholeNumber(value: string, name: string): number {
  if (!/^\d{1,5}$/.test(value)) throw new Error(`${name} must be a whole number, got ${JSON.stringify(value)}`);
  return Number(value);
}

export function loadConfig(env: Env = process.env): Config {
  const token = secret(env, 'SOFA_HA_TOKEN');
  return {
    port: Number(env.SOFA_PORT ?? 8090),
    dbPath: env.SOFA_DB_PATH ?? 'sofa.db',
    mediaDir: env.SOFA_MEDIA_DIR ?? 'media',
    companionDir: env.SOFA_COMPANION_DIR ?? new URL('../../companion/dist', import.meta.url).pathname,
    passwordHash: required(secret(env, 'SOFA_PASSWORD_HASH'), 'SOFA_PASSWORD_HASH or SOFA_PASSWORD_HASH_FILE'),
    secureCookies: env.SOFA_INSECURE_COOKIES !== '1',
    ha: token
      ? {
          url: required(env.SOFA_HA_URL, 'SOFA_HA_URL').replace(/\/$/, ''),
          token,
          tvEntity: env.SOFA_HA_TV_ENTITY ?? 'media_player.samung_tv',
          remoteEntity: env.SOFA_HA_REMOTE_ENTITY ?? 'remote.samung_tv',
          notifyServices: (env.SOFA_HA_NOTIFY ?? 'mobile_app_hidekis_iphone,mobile_app_ioannas_iphone').split(',').map((s) => s.trim()).filter(Boolean),
          dryRun: env.SOFA_HA_DRY_RUN === '1',
        }
      : null,
    // Household policy (plan, Decisions): reset at 04:00 Berlin time, switch off at once. The daily minutes are in the layout.
    allowance: {
      timeZone: env.SOFA_TIME_ZONE ?? 'Europe/Berlin',
      resetMinutes: clockTime(env.SOFA_ALLOWANCE_RESET ?? '04:00', 'SOFA_ALLOWANCE_RESET'),
      graceSeconds: wholeNumber(env.SOFA_ALLOWANCE_GRACE_SECONDS ?? '0', 'SOFA_ALLOWANCE_GRACE_SECONDS'),
    },
  };
}
