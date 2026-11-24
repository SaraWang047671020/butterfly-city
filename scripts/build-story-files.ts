/**
 * npm run story-files (story-layer tasks 1 and 2, done by Claude Code):
 * - copies data/config/citizens.json and data/config/model-limits.json to public/data/ (no transformation);
 * - writes public/data/income-spread.json from the FIA quartile file of income year 2023 in data/raw/income/;
 * - copies data/config/characters.json and writes public/data/wages.json from DGBAS data.gov.tw 9663 (play-loop task 3).
 * Exits 1 on any error and writes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DISTRICTS } from './lib/districts.ts';
import { ROOT, raw } from './lib/paths.ts';
import { FIA_REFERENCE_FILE } from './pipeline/params/part1.ts';
import { GHOST_REFERENCE_YEAR } from './pipeline/params/ghost.ts';
import { parseFiaQuartiles } from './pipeline/parsers/income.ts';
import { incomeSpreadOf, serializeIncomeSpread } from './story/income-spread.ts';
import { updateModelFacts } from './lib/model-facts.ts';
import { surveyCheck } from './pipeline/commute/survey-check.ts';
import { WAGES_FILE } from './sources/wages.ts';
import { parseWagesXml, serializeWageFile, wageFileOf } from './story/wages.ts';

const COPIES = ['citizens.json', 'model-limits.json', 'characters.json'] as const;

try {
  const outputs = new Map<string, string>();
  for (const name of COPIES) {
    const text = fs.readFileSync(path.join(ROOT, 'data', 'config', name), 'utf8');
    JSON.parse(text); // stop on invalid JSON before anything is written
    outputs.set(path.join(ROOT, 'public', 'data', name), text);
  }
  const fia = raw(FIA_REFERENCE_FILE);
  const rows = parseFiaQuartiles(fs.readFileSync(fia, 'utf8'), `data/raw/${FIA_REFERENCE_FILE}`, GHOST_REFERENCE_YEAR);
  const spread = incomeSpreadOf(
    rows,
    DISTRICTS.map((d) => d.code),
  );
  outputs.set(path.join(ROOT, 'public', 'data', 'income-spread.json'), serializeIncomeSpread(spread));
  const wageFile = wageFileOf(parseWagesXml(fs.readFileSync(raw(WAGES_FILE), 'utf8'), `data/raw/${WAGES_FILE}`), `data/raw/${WAGES_FILE}`);
  outputs.set(path.join(ROOT, 'public', 'data', 'wages.json'), serializeWageFile(wageFile));
  // Model_Facts commute values from the committed public data, with the survey check of the data pipeline
  // (scripts/pipeline/commute/survey-check.ts): New Taipei residents (2025 mean population) to Taipei jobs (job shares).
  const pub = (name: string) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', name), 'utf8'));
  const matrix = pub('commute-matrix.json') as { codes: string[]; minutes: number[][] };
  const history = pub('history.json') as { indicators: { id: string; series: Record<string, { value: number | null }[]> }[] };
  const params = pub('params.json') as { parameters: Record<string, { value: number }> };
  const pop = history.indicators.find((i) => i.id === 'population');
  if (pop === undefined) throw new Error('history.json has no population');
  const population = new Map(
    Object.entries(pop.series).map(([code, s]) => {
      const last = s.slice(-4).map((r) => r.value);
      if (last.length !== 4 || last.some((v) => v === null)) throw new Error(`population of ${code} has no 2025 values`);
      return [code, (last as number[]).reduce((a, b) => a + b, 0) / 4];
    }),
  );
  const jobShare = new Map(
    DISTRICTS.map((d) => {
      const p = params.parameters[`commute.jobShare.${d.code}`];
      if (p === undefined) throw new Error(`params.json has no commute.jobShare.${d.code}`);
      return [d.code, p.value];
    }),
  );
  const survey = surveyCheck({ codes: matrix.codes, minutes: matrix.minutes, cityOf: new Map(DISTRICTS.map((d) => [d.code, d.city])), population, jobShare });

  for (const [file, text] of outputs) fs.writeFileSync(file, text);
  updateModelFacts({ commuteModelled: survey.modelled, commuteSurvey: survey.survey });
  const values = Object.values(spread.sigma);
  console.log(
    `npm run story-files: copied ${COPIES.join(', ')}; income-spread.json with ${values.length} sigmas (${Math.min(...values)}–${Math.max(...values)}); model-facts.json commute ${survey.modelled.toFixed(1)} min modelled, ${survey.survey} min survey; wages.json with ${Object.keys(wageFile.earnings).length} industries.`,
  );
} catch (e) {
  console.error(`npm run story-files: ${(e as Error).message}; nothing was written.`);
  process.exit(1);
}
