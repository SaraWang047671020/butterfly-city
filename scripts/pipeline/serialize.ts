// Canonical JSON serializer for the data pipeline (Requirements 17.3, 17.5).
// Output is byte-stable: 2-space indent, LF only, one trailing LF, no BOM.

import { roundTo } from "./numeric.ts";

function numberToken(x: number): string {
  if (!Number.isFinite(x)) throw new Error(`serializeJson: non-finite number ${String(x)}`);
  const s = String(x === 0 ? 0 : x);
  if (/e/i.test(s)) throw new Error(`serializeJson: number needs an exponent token: ${s}`);
  return s;
}

/** `String(roundTo(x, d))`, with `-0` as `0`. Throws on NaN, Infinity or an exponent token. */
export function formatNumber(x: number, d: number): string {
  if (!Number.isFinite(x)) throw new Error(`formatNumber: non-finite number ${String(x)}`);
  return numberToken(roundTo(x, d));
}

function isPrimitive(v: unknown): boolean {
  return v === null || typeof v !== "object";
}

function primitiveText(v: unknown): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "number":
      return numberToken(v);
    case "string":
      return JSON.stringify(v);
    case "boolean":
      return v ? "true" : "false";
    default:
      throw new Error(`serializeJson: unsupported value of type ${typeof v}`);
  }
}

function write(v: unknown, indent: string): string {
  if (isPrimitive(v)) return primitiveText(v);
  const inner = `${indent}  `;
  if (Array.isArray(v)) {
    if (v.every(isPrimitive)) return `[${v.map(primitiveText).join(", ")}]`;
    return `[\n${v.map((m) => inner + write(m, inner)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.every(([, m]) => isPrimitive(m))) {
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([k, m]) => `${JSON.stringify(k)}: ${primitiveText(m)}`).join(", ")} }`;
  }
  const lines = entries.map(([k, m]) => `${inner}${JSON.stringify(k)}: ${write(m, inner)}`);
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

/** Serializes `value` canonically. Ends with exactly one `\n`. */
export function serializeJson(value: unknown): string {
  return `${write(value, "")}\n`;
}
