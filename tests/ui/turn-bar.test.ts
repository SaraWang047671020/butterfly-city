import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');
const ts = readFileSync(resolve(ROOT, 'src/ui/turn-bar/turn-bar.ts'), 'utf8');
const css = readFileSync(resolve(ROOT, 'src/styles/turn-bar.css'), 'utf8');

describe('Turn_Bar source', () => {
  it('uses only tokens in CSS: no hex colors or durations, and no page position', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(body).not.toMatch(/\b\d+(\.\d+)?(ms|s)\b/);
    expect(body).not.toMatch(/position\s*:\s*(fixed|absolute|sticky)/);
  });

  it('reads every visible string from strings.ts', () => {
    expect(ts).toContain("from '../strings.ts'");
    expect(ts).not.toMatch(/textContent\s*=\s*'/);
  });

  it('dispatches the four actions (Import only opens the dialog) and holds no simulation or data imports', () => {
    for (const call of ['nextQuarter', 'fastForward', 'exportSaveCode', 'openImport']) {
      expect(ts).toContain(`actions.${call}(`);
    }
    expect(ts).not.toContain('importSaveCode(');
    expect(ts).not.toContain('textarea');
    expect(ts).not.toMatch(/from '\.\.\/\.\.\/(simulation|game|data|save)\//);
  });
});
