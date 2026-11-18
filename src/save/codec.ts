// Save_Code: 'BC1.' + base64url(utf8(canonicalJson(save))). decodeSaveCode never throws.

import type { Save } from '../types/save.ts';
import { decodeUtf8Base64url, encodeUtf8Base64url } from './base64url.ts';
import { canonicalJson } from './canonical-json.ts';
import { asSave, validateSave } from './validate-save.ts';
import type { SaveCodeError, SaveValidationContext } from './validate-save.ts';

export type { SaveCodeError, SaveValidationContext, SaveValidationStep } from './validate-save.ts';

export const SAVE_CODE_PREFIX = 'BC1.';
export const MAX_SAVE_CODE_LENGTH = 200_000;

export type DecodeResult =
  | { readonly ok: true; readonly save: Save }
  | { readonly ok: false; readonly error: SaveCodeError };

export function encodeSave(save: Save): string {
  return SAVE_CODE_PREFIX + encodeUtf8Base64url(canonicalJson(save));
}

function failure(step: SaveCodeError['step'], path: string, reason: string): DecodeResult {
  return { ok: false, error: { step, path, reason } };
}

export function decodeSaveCode(text: string, ctx: SaveValidationContext): DecodeResult {
  try {
    const trimmed = text.trim();
    if (!trimmed.startsWith(SAVE_CODE_PREFIX)) {
      return failure('prefix', '$', `a save code starts with ${SAVE_CODE_PREFIX}`);
    }
    if (trimmed.length > MAX_SAVE_CODE_LENGTH) {
      return failure('length', '$', `a save code has at most ${MAX_SAVE_CODE_LENGTH} characters`);
    }
    if (trimmed.length <= SAVE_CODE_PREFIX.length) {
      return failure('length', '$', 'the save code has no content after the prefix');
    }
    const json = decodeUtf8Base64url(trimmed.slice(SAVE_CODE_PREFIX.length));
    if (json === null) return failure('encoding', '$', 'the save code is not valid base64url text');
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return failure('json', '$', 'the save code does not contain valid JSON');
    }
    const error = validateSave(parsed, ctx);
    if (error !== null) return { ok: false, error };
    return { ok: true, save: asSave(parsed) };
  } catch {
    return failure('structure', '$', 'unreadable save code');
  }
}
