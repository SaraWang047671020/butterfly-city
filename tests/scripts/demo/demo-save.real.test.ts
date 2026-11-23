// Demo_Save output and recompute on the real files (game-ui task 19.3; Requirements 14.2, 14.7, 14.8, 19.7).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { readDemoInputs } from '../../../scripts/demo/inputs.ts';
import { runDemo } from '../../../scripts/demo/run-demo.ts';
import type { DemoInputs, DemoSuccess } from '../../../scripts/demo/run-demo.ts';
import { decodeSaveCode } from '../../../src/save/codec.ts';
import type { SaveValidationContext } from '../../../src/save/codec.ts';
import { DEMO_SAVE_CODE } from '../../../src/save/demo-save.generated.ts';
import { fromSave } from '../../../src/game/core/session.ts';
import { computeNext } from '../../../src/game/core/turns.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const TIMEOUT = 120_000;

let inputs: DemoInputs;
let result: DemoSuccess;

beforeAll(async () => {
  const read = await readDemoInputs(ROOT);
  if (!read.ok) throw new Error(`${read.message} ${read.details.join('; ')}`);
  inputs = read.inputs;
  const r = runDemo(inputs);
  if (!r.ok) throw new Error(`runDemo failed: ${r.message} ${r.failures.join('; ')}`);
  result = r;
}, TIMEOUT);

describe('Demo_Save on the real files', () => {
  it('runDemo output equals the committed demo-save.generated.ts character for character (14.7)', () => {
    const committed = readFileSync(join(ROOT, 'src', 'save', 'demo-save.generated.ts'), 'utf8');
    expect(result.fileText).toBe(committed);
  }, TIMEOUT);

  it('the Demo_Save_Code passes Requirement 13.5 validation with a full context (14.2)', () => {
    const ctx: SaveValidationContext = {
      registry: inputs.registry,
      districts: inputs.data.districts.map((d) => ({ code: d.code, city: d.city })),
    };
    const decoded = decodeSaveCode(DEMO_SAVE_CODE, ctx);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.save).toEqual(result.save);
    expect(decoded.save.demo).toBe(true);
    expect(decoded.save.next).toBe('2021Q1');
  }, TIMEOUT);

  it('recomputes to 2020Q4 and the 2021Q1 lookahead in all three Scenarios without Engine_Error (14.8)', () => {
    const loaded = fromSave(result.save, inputs.data, inputs.registry);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.session.next).toBe('2021Q1');
    const prior = loaded.session.computed;
    expect(prior).not.toBeNull();
    for (const s of ['central', 'low', 'high'] as const) {
      expect(prior?.[s].length).toBe(24);
    }
    const look = computeNext(loaded.session);
    expect(look.engineError).toBeNull();
    expect(look.computed.length).toBe(1);
    const c = look.session.computed;
    expect(c).not.toBeNull();
    for (const s of ['central', 'low', 'high'] as const) {
      expect(c?.[s].length).toBe(25);
    }
  }, TIMEOUT);
});
