/**
 * Wages: DGBAS regular monthly earnings per employee by industry (歷年受僱員工每人每月經常性薪資),
 * data.gov.tw 9663, XML, Open Government Data License v1. Used for the Wage_File of the play-loop spec
 * (Requirement 3.4). Coverage notes of the dataset: agriculture, government, schools above primary level,
 * religious and occupational organisations are excluded; education covered only 教育輔助及其他教育業 from
 * 2009 to 2018; health covered only 醫療保健業 before 2018.
 */
import fs from 'node:fs';
import { datasetMeta } from '../lib/datagov.ts';
import { downloadFile, notHtml } from '../lib/http.ts';
import { raw } from '../lib/paths.ts';
import { parseWagesXml } from '../story/wages.ts';
import { logResult, type Source } from './types.ts';

export const WAGES_DATASET = 9663;
export const WAGES_FILE = 'wages/dgbas-9663-regular-earnings.xml';

export const wages: Source = {
  id: 'wages',
  title: 'DGBAS regular monthly earnings by industry (data.gov.tw 9663)',
  async download({ force }) {
    const resource = (await datasetMeta(WAGES_DATASET)).distribution[0];
    if (resource === undefined) throw new Error(`data.gov.tw ${WAGES_DATASET} lists no resource`);
    logResult(
      'DGBAS 9663 regular earnings',
      await downloadFile(encodeURI(decodeURI(resource.resourceDownloadUrl)), raw(WAGES_FILE), { force, minBytes: 100_000, validate: notHtml }),
    );
  },
  async check() {
    const file = raw(WAGES_FILE);
    if (!fs.existsSync(file)) {
      console.log(`  missing ${file}`);
      return;
    }
    const records = parseWagesXml(fs.readFileSync(file, 'utf8'), WAGES_FILE);
    const years = records.filter((r) => /^\d{4}$/.test(r.period)).map((r) => r.period);
    console.log(`  ${records.length} records; annual records ${years[0]} to ${years[years.length - 1]}`);
  },
};
