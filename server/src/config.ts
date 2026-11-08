import { readFileSync } from 'node:fs';

export interface HaConfig {
  url: string;
  token: string;
  tvEntity: string; // media_player.* for this TV
  remoteEntity: string; // remote.* for this TV
  notifyServices: string[]; // notify.* services of the adults' phones, without the "notify." prefix
}

export interface Config {
  port: number;
  dbPath: string;
  mediaDir: string;
  companionDir: string;
  passwordHash: string;
  secureCookies: boolean;
  ha: HaConfig | null; // null until a Home Assistant token is configured
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
        }
      : null,
  };
}
