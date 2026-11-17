/**
 * TDX (Transport Data eXchange) access for the download scripts.
 *
 * Credentials come only from the environment variables TDX_CLIENT_ID and TDX_CLIENT_SECRET. The access token
 * lives in memory only. Neither the credentials nor the token are written to a file, a log line or an error
 * message: every error text passes through `redact` before it leaves this module.
 */
import fs from 'node:fs';
import path from 'node:path';
import { BROWSER_UA, sleep } from './http.ts';

export const TDX_API = 'https://tdx.transportdata.tw/api/basic/v2/Rail/Metro';
const TOKEN_URL = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';

export interface TdxCredentials {
  readonly id: string;
  readonly secret: string;
}

/** The one message printed when a credential variable is absent or blank. It names both variables, never a value. */
export const TDX_CREDENTIALS_MESSAGE =
  'TDX credentials missing: set the environment variables TDX_CLIENT_ID and TDX_CLIENT_SECRET (see data/DOWNLOAD.md). Nothing was downloaded.';

/** Reads both variables; returns undefined when either is absent or blank. */
export function readTdxCredentials(env: Readonly<Record<string, string | undefined>> = process.env): TdxCredentials | undefined {
  const id = env['TDX_CLIENT_ID']?.trim();
  const secret = env['TDX_CLIENT_SECRET']?.trim();
  return id && secret ? { id, secret } : undefined;
}

/** Throws an Error with the credentials message when a variable is absent or blank. Makes no network call. */
export function requireTdxCredentials(env: Readonly<Record<string, string | undefined>> = process.env): TdxCredentials {
  const credentials = readTdxCredentials(env);
  if (!credentials) throw new Error(TDX_CREDENTIALS_MESSAGE);
  return credentials;
}

/** Removes every secret value, bearer value, `access_token` value and `Authorization` header value from a text. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const s of secrets) if (s.length > 0) out = out.split(s).join('[redacted]');
  return out
    .replace(/(Authorization\s*[:=]\s*)\S+(\s+\S+)?/gi, '$1[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/("?access_token"?\s*[:=]\s*)"?[^"\s,}&]+"?/gi, '$1[redacted]');
}

/** A TDX session: the token is held in this closure and never leaves it except in request headers. */
export interface TdxSession {
  /** GETs a TDX URL and returns the body text. Errors carry only redacted text. */
  get(url: string): Promise<string>;
}

export async function openTdxSession(credentials: TdxCredentials): Promise<TdxSession> {
  const secrets = [credentials.id, credentials.secret];
  let token: string;
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': BROWSER_UA },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: credentials.id, client_secret: credentials.secret }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { access_token?: unknown };
    if (typeof body.access_token !== 'string' || body.access_token === '') throw new Error('response has no token');
    token = body.access_token;
  } catch (e) {
    throw new Error(`TDX token request failed: ${redact((e as Error).message, secrets)}`);
  }
  secrets.push(token);
  return {
    async get(url) {
      let lastStatus = 0;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Authorization: `Bearer ${token}`, 'Accept-Encoding': 'gzip' } });
          if (res.ok) return await res.text();
          lastStatus = res.status;
          if (res.status !== 429 && res.status < 500) break;
        } catch (e) {
          throw new Error(redact((e as Error).message, secrets));
        }
        await sleep(1000 * 2 ** attempt);
      }
      throw new Error(`HTTP ${lastStatus}`);
    },
  };
}

export type TdxDownloadResult =
  | { readonly status: 'skipped' | 'downloaded'; readonly bytes: number }
  | { readonly status: 'failed'; readonly error: string };

/** Downloads one TDX JSON array to `dest`. Never throws. Skips an existing file unless `force`. */
export async function tdxDownload(session: TdxSession, url: string, dest: string, force: boolean): Promise<TdxDownloadResult> {
  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 0) return { status: 'skipped', bytes: fs.statSync(dest).size };
  try {
    const text = await session.get(url);
    if (!text.trimStart().startsWith('[')) return { status: 'failed', error: 'response is not a JSON array' };
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
    return { status: 'downloaded', bytes: Buffer.byteLength(text) };
  } catch (e) {
    return { status: 'failed', error: (e as Error).message };
  }
}
