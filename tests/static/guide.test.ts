// First_Play_Guide (play-loop Requirement 8.3): the guide only points and listens; it never applies a policy, computes
// a quarter or presses a control for the player. Checked on the source: no UiActions, no synthetic clicks or events.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GUIDE_STEPS } from '../../src/ui/guide/first-play.ts';

const source = readFileSync('src/ui/guide/first-play.ts', 'utf8');

describe('First_Play_Guide', () => {
  it('has five steps in the order of Requirement 8.2', () => {
    expect(GUIDE_STEPS.map((s) => s.targets[0])).toEqual([
      '.ui-policy-card',
      '.ui-policy-dialog__slider',
      '.ui-block--turn-bar .turn-bar__button',
      '.ui-brief__go',
      '.ui-report-button',
    ]);
  });

  it('never acts for the player', () => {
    expect(source).not.toMatch(/UiActions|actions\.|\.click\(\)|dispatchEvent|new (Mouse|Pointer|Keyboard)Event/);
  });
});
