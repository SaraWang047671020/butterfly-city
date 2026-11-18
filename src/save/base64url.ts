// Strict base64url (RFC 4648 section 5), no padding. Pure; works in browsers and Node.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const LOOKUP: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

export function encodeBytes(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]!;
  }
  return out;
}

/** Strict decode. Returns null for any non-canonical input. */
export function decodeBytes(text: string): Uint8Array | null {
  const len = text.length;
  if (len % 4 === 1) return null;
  const values = new Array<number>(len);
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    const v = c < 128 ? LOOKUP[c]! : -1;
    if (v < 0) return null;
    values[i] = v;
  }
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  let i = 0;
  for (; i + 3 < len; i += 4) {
    const n = (values[i]! << 18) | (values[i + 1]! << 12) | (values[i + 2]! << 6) | values[i + 3]!;
    out[o++] = (n >> 16) & 255;
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }
  const rest = len - i;
  if (rest === 2) {
    const n = (values[i]! << 6) | values[i + 1]!;
    if ((n & 15) !== 0) return null;
    out[o++] = n >> 4;
  } else if (rest === 3) {
    const n = (values[i]! << 12) | (values[i + 1]! << 6) | values[i + 2]!;
    if ((n & 3) !== 0) return null;
    out[o++] = (n >> 10) & 255;
    out[o++] = (n >> 2) & 255;
  }
  return out;
}

export function encodeUtf8Base64url(text: string): string {
  return encodeBytes(new TextEncoder().encode(text));
}

/** Returns null for invalid base64url or invalid UTF-8. */
export function decodeUtf8Base64url(code: string): string | null {
  const bytes = decodeBytes(code);
  if (bytes === null) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
