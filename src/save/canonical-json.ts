// Canonical JSON: object keys sorted by UTF-16 code unit order at every level,
// arrays in order, no whitespace, numbers and strings via JSON.stringify.

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value);
    if (text === undefined) throw new TypeError('canonicalJson: value is not JSON-serializable');
    return text;
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalJson(item === undefined ? null : item)).join(',') + ']';
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item === undefined) continue;
    parts.push(JSON.stringify(key) + ':' + canonicalJson(item));
  }
  return '{' + parts.join(',') + '}';
}
