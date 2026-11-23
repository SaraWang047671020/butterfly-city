// Dialog_Frame (play-loop Requirement 9): every dialog of the App goes through the one dialog manager, which opens
// with showModal (top layer, takes pointer events inside the pointer-transparent overlay) and has a Close control.
// The pointer-click check of Requirement 9.3 is done by hand in a browser and recorded in KIRO-LOG.md, because the
// project has no DOM test library (adding one needs the user's approval).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = 'src';
const FRAME = join('src', 'ui', 'a11y', 'dialog.ts');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('Dialog_Frame', () => {
  const all = files(SRC).filter((f) => !f.endsWith('.generated.ts'));

  it('only the dialog manager creates a <dialog> or calls showModal', () => {
    const offenders = all.filter((f) => f !== FRAME && /createElement\(\s*['"]dialog['"]\s*\)|\.showModal\(/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the dialog manager opens modally and has a Close control and an action row', () => {
    const text = readFileSync(FRAME, 'utf8');
    expect(text).toMatch(/\.showModal\(\)/);
    expect(text).toMatch(/ui-dialog-close/);
    expect(text).toMatch(/ui-dialog-actions/);
  });

  it('every caller passes a Close label from the strings', () => {
    const calls = all.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/createDialogManager\(([^;]*?)\);/gs)].map((m) => ({ f, args: m[1] ?? '' })));
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.args.split(',').length, c.f).toBeGreaterThanOrEqual(3);
  });

  it('dialog buttons go to the action row, not into the body', () => {
    expect(readFileSync(join('src', 'ui', 'dialogs', 'dialogs.ts'), 'utf8')).not.toMatch(/dialog__actions/);
  });
});
