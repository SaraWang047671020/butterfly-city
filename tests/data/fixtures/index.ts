// Reads the fixture Data_Files for tests in Node. Regenerate with: node tests/data/fixtures/generate.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineIdSet } from '../../../scripts/pipeline/params/engine-ids.ts';
import { EXPECTED_POLICY_SERIES_IDS } from '../../../src/data/expected.ts';
import type { ValidationContext } from '../../../src/data/validate.ts';
import { HISTORY_INDICATOR_IDS } from '../../../src/types/data-files.ts';
import { DISTRICT_CODES, quarterList } from '../../simulation/fixtures/index.ts';
import { paramSourceType } from './source-types.ts';

export type FixtureFileName =
  | 'districts.json'
  | 'history.json'
  | 'policy-track.json'
  | 'events.json'
  | 'params.json'
  | 'commute-matrix.json';

const DIR = dirname(fileURLToPath(import.meta.url));

/** Parsed content of one fixture file. A fresh object on every call, so tests may mutate it. */
export function readFixture(name: FixtureFileName): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  return JSON.parse(readFileSync(join(DIR, name), 'utf8'));
}

/** The validation context that matches the fixture files. */
export function fixtureContext(): ValidationContext {
  const params = readFixture('params.json').parameters as Record<string, unknown>;
  return {
    districtCodes: [...DISTRICT_CODES],
    quarters: [...quarterList(44)],
    indicatorIds: [...HISTORY_INDICATOR_IDS],
    policySeriesIds: [...EXPECTED_POLICY_SERIES_IDS],
    engineIdSet: [...engineIdSet()],
    sourceTypes: Object.fromEntries(Object.keys(params).map((id) => [id, paramSourceType(id)])),
  };
}
