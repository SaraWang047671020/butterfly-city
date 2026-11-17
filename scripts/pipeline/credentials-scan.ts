/**
 * Credentials scan (Requirements 25.5, 25.6, 27.3). Reports the file and 1-based line of every line that
 * contains a TDX credential value, an `access_token` key or an `Authorization` header value.
 * A finding never contains the matched text.
 */
import type { RawReader } from './raw-reader.ts';

export type CredentialKind = 'secret' | 'access_token' | 'authorization';

export interface CredentialFinding {
  readonly path: string;
  /** 1-based line number. */
  readonly line: number;
  readonly kind: CredentialKind;
}

export interface ScanFile {
  readonly path: string;
  readonly text: string;
}

/** A JSON or header-style `access_token` key (`"access_token":`, `access_token=`). */
const ACCESS_TOKEN_KEY = /access_token["']?\s*[:=]/i;
/** An `Authorization` header or JSON key followed by a non-empty value. */
const AUTHORIZATION_VALUE = /authorization["']?\s*[:=]\s*["']?[^\s"',}]/i;

/** Names of the two environment variables that hold TDX credentials. */
export const TDX_CREDENTIAL_VARIABLES: readonly string[] = ['TDX_CLIENT_ID', 'TDX_CLIENT_SECRET'];

/** Values of the two TDX variables that are set and not blank. Call once per run; never print the result. */
export function readTdxSecrets(env: Readonly<Record<string, string | undefined>>): string[] {
  const secrets: string[] = [];
  for (const name of TDX_CREDENTIAL_VARIABLES) {
    const value = env[name];
    if (value !== undefined && value.trim() !== '') secrets.push(value);
  }
  return secrets;
}

export function scanForCredentials(files: readonly ScanFile[], secrets: readonly string[]): CredentialFinding[] {
  const values = secrets.filter((s) => s !== '');
  const findings: CredentialFinding[] = [];
  for (const file of files) {
    const lines = file.text.split(/\r\n|\n|\r/);
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i] as string;
      let kind: CredentialKind | undefined;
      if (values.some((s) => text.includes(s))) kind = 'secret';
      else if (ACCESS_TOKEN_KEY.test(text)) kind = 'access_token';
      else if (AUTHORIZATION_VALUE.test(text)) kind = 'authorization';
      if (kind !== undefined) findings.push({ path: file.path, line: i + 1, kind });
    }
  }
  return findings;
}

/** Raw directories written by scripts/download.ts that can hold TDX responses. */
export const CREDENTIAL_RAW_DIRS: readonly string[] = ['stations', 'fares', 'timetables'];

const TEXT_EXTENSIONS = ['.json', '.csv', '.txt', '.xml', '.log', '.geojson'];

/** Text files under the given raw directories (recursive). Absent directories give no files. */
export function readRawTextFiles(reader: RawReader, dirs: readonly string[] = CREDENTIAL_RAW_DIRS): ScanFile[] {
  const files: ScanFile[] = [];
  const walk = (rel: string): void => {
    for (const name of reader.list(rel)) {
      const child = `${rel}/${name}`;
      if (reader.list(child).length > 0) walk(child);
      else if (TEXT_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext)) && reader.exists(child)) {
        files.push({ path: reader.display(child), text: reader.readText(child) });
      }
    }
  };
  for (const dir of dirs) walk(dir);
  return files;
}
