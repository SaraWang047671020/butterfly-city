/**
 * Village population and village boundaries, for the population-weighted district centroids of the commute model.
 *
 *   - ODRP019 (households and population by household type and sex, ROC year 114), ris.gov.tw open API, paged
 *     like the ODRP002/ODRP014 downloads: villages/moi-odrp019-114-page{n}.json (the response of each page).
 *   - Village boundaries (TWD97 longitude and latitude, ROC 114 edition), data.gov.tw dataset 130549 (NLSC):
 *     villages/village-boundaries-114.zip, an outer zip holding an inner zip with the VILLAGE_NLSC_* shapefile.
 *     Read in place; nothing is extracted.
 */
import fs from 'node:fs';
import { downloadFile, getText, sleep } from '../lib/http.ts';
import { raw } from '../lib/paths.ts';
import { logResult, type Source } from './types.ts';

export const ODRP019_URL = 'https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP019/114';
export const VILLAGE_BOUNDARY_URL = 'https://www.land.moi.gov.tw/chhtml/DownloadGovDoc?gsno=PY9YAR&gdid=533';

const dir = (...p: string[]) => raw('villages', ...p);

export const odrp019PageFile = (page: number): string => `villages/moi-odrp019-114-page${page}.json`;
export const VILLAGE_ZIP_FILE = 'villages/village-boundaries-114.zip';
export const ODRP019_PAGES = 4;

export const villages: Source = {
  id: 'villages',
  title: 'ODRP019 village population (ROC 114) and village boundary shapefile (data.gov.tw 130549)',
  async download({ force }) {
    let totalPage = ODRP019_PAGES;
    for (let page = 1; page <= totalPage; page++) {
      const file = dir(`moi-odrp019-114-page${page}.json`);
      if (!force && fs.existsSync(file) && fs.statSync(file).size > 0) {
        console.log(`  ODRP019 page ${page}: skipped`);
        continue;
      }
      const text = await getText(`${ODRP019_URL}?PAGE=${page}`);
      const res = JSON.parse(text) as { responseCode?: string; totalPage?: string; responseData?: unknown[] };
      if (res.responseCode !== 'OD-0101-S') throw new Error(`ODRP019 page ${page}: response code ${res.responseCode ?? 'missing'}`);
      totalPage = Number(res.totalPage ?? totalPage);
      fs.mkdirSync(dir(), { recursive: true });
      fs.writeFileSync(file, text);
      console.log(`  ODRP019 page ${page}/${totalPage}: ${res.responseData?.length ?? 0} rows (${text.length} chars)`);
      await sleep(200);
    }
    logResult('village boundaries', await downloadFile(VILLAGE_BOUNDARY_URL, dir('village-boundaries-114.zip'), {
      force,
      minBytes: 1_000_000,
      validate: (b) => (b.subarray(0, 2).toString('latin1') === 'PK' ? undefined : 'not a ZIP file'),
    }));
  },
  async check() {
    for (let page = 1; page <= ODRP019_PAGES; page++) {
      const f = dir(`moi-odrp019-114-page${page}.json`);
      console.log(`  page ${page}: ${fs.existsSync(f) ? `${fs.statSync(f).size} bytes` : 'missing'}`);
    }
    const z = dir('village-boundaries-114.zip');
    console.log(`  boundaries: ${fs.existsSync(z) ? `${fs.statSync(z).size} bytes` : 'missing'}`);
  },
};
