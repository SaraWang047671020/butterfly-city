import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { wrapFocusIndex } from '../../src/ui/a11y/focus.ts';
import { isNewAnnouncement } from '../../src/ui/a11y/live-region.ts';
import type { Announcement } from '../../src/types/view.ts';

const UI = resolve(import.meta.dirname, '..', '..', 'src', 'ui');
const ann = (id: number): Announcement => ({
  id,
  politeness: 'polite',
  quarter: null,
  eventTitles: [],
  engineError: null,
});

describe('wrapFocusIndex', () => {
  it('wraps at both ends', () => {
    expect(wrapFocusIndex(3, 2, false)).toBe(0);
    expect(wrapFocusIndex(3, 0, true)).toBe(2);
    expect(wrapFocusIndex(0, 0, false)).toBe(-1);
  });

  it('always stays inside the list (Requirement 17.13)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: -2, max: 25 }), fc.boolean(), (n, cur, back) => {
        const i = wrapFocusIndex(n, cur, back);
        return i >= 0 && i < n;
      }),
    );
  });
});

describe('isNewAnnouncement', () => {
  it('writes only on a new id (Requirements 17.7, 17.8)', () => {
    expect(isNewAnnouncement(null, ann(1))).toBe(true);
    expect(isNewAnnouncement(1, ann(1))).toBe(false);
    expect(isNewAnnouncement(1, ann(2))).toBe(true);
    expect(isNewAnnouncement(1, null)).toBe(false);
  });
});

describe('component base files', () => {
  for (const f of ['component.ts', 'a11y/dialog.ts', 'a11y/live-region.ts', 'a11y/focus.ts']) {
    it(`${f} sets no page position, colour or inline style`, () => {
      const text = readFileSync(join(UI, f), 'utf8');
      expect(text).not.toMatch(/\.style\b|style\.|position\s*:|#[0-9a-fA-F]{3,8}\b/);
    });
  }
});
