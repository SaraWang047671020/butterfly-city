/**
 * Social housing projects, National Land Management Agency (內政部國土管理署) social housing portal.
 * No license is stated on the portal.
 *   - Project list: POST ScheduleApi.asmx/GetScheduleData (cityCode A = Taipei, F = New Taipei)
 *   - Same list as XLSX: GET ExportScheduleExcel.ashx
 *   - Per-project detail (district code, address, coordinates, start/completion/move-in dates):
 *     POST houseAPI.asmx/GetCityDashboardData
 * The portal rejects requests without a browser User-Agent, Referer and Origin.
 */
import fs from 'node:fs';
import { downloadFile, postJson, sleep } from '../lib/http.ts';
import { raw } from '../lib/paths.ts';
import { logResult, type Source } from './types.ts';

const BASE = 'https://socialhousing.nlma.gov.tw/CPA_SocialHousing_Portal/';
const CITIES = [
  { code: 'A', name: 'Taipei' },
  { code: 'F', name: 'New Taipei' },
] as const;
const headers = (city: string) => ({ Referer: `${BASE}scheduleContent.aspx?city=${city}`, Origin: 'https://socialhousing.nlma.gov.tw' });
const dir = (...p: string[]) => raw('social-housing', ...p);

export interface ScheduleRow {
  readonly setupplan_guid: string;
  readonly setupplan_name: string;
  readonly execute_status_description: string;
  readonly household_num: string;
  readonly strEndDate: string;
  readonly pre_EndScheduleDate: string;
}

function readList(city: string): ScheduleRow[] {
  const file = dir(`nlma-portal-GetScheduleData-${city}.json`);
  if (!fs.existsSync(file)) return [];
  const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { Data?: { data?: ScheduleRow[] } };
  return j.Data?.data ?? [];
}

/** Parses an ROC date "yyy/mm/dd" to an AD year; undefined if empty or malformed. */
export function rocSlashDateYear(value: string): number | undefined {
  const m = value.trim().match(/^(\d{2,3})\/\d{1,2}\/\d{1,2}$/);
  return m ? Number(m[1]) + 1911 : undefined;
}

export const socialHousing: Source = {
  id: 'social-housing',
  title: 'NLMA social housing portal: every project in Taipei and New Taipei, with details',
  async download({ force }) {
    for (const city of CITIES) {
      const listFile = dir(`nlma-portal-GetScheduleData-${city.code}.json`);
      if (force || !fs.existsSync(listFile)) {
        const res = await postJson<{ d: unknown }>(`${BASE}ASMX/ScheduleApi.asmx/GetScheduleData`,
          { cityCode: city.code, setupUnit: '', status: 'All', pageNumber: 1, pageSize: 1000 }, headers(city.code));
        fs.mkdirSync(dir(), { recursive: true });
        fs.writeFileSync(listFile, JSON.stringify(res.d, null, 1));
      }
      const rows = readList(city.code);
      console.log(`  ${city.name}: ${rows.length} projects in list`);
      logResult(`${city.name} XLSX`, await downloadFile(`${BASE}ASMX/ExportScheduleExcel.ashx?cityCode=${city.code}&setupUnit=&statuses=`,
        dir(`nlma-portal-ExportScheduleExcel-${city.code}.xlsx`), { force, headers: headers(city.code), minBytes: 1000 }));
      let fetched = 0;
      for (const row of rows) {
        const f = dir('nlma-portal-dashboard', `${row.setupplan_guid}.json`);
        if (!force && fs.existsSync(f)) continue;
        const detail = await postJson<unknown>(`${BASE}ASMX/houseAPI.asmx/GetCityDashboardData`, { setupplanGuid: row.setupplan_guid }, headers(city.code));
        fs.mkdirSync(dir('nlma-portal-dashboard'), { recursive: true });
        fs.writeFileSync(f, JSON.stringify(detail));
        fetched++;
        await sleep(250);
      }
      console.log(`  ${city.name}: ${fetched} project details fetched`);
    }
    // Second source: Taipei Urban Development Department project list (data.taipei 00007283, OGDL v1).
    logResult('Taipei UDD project list', await downloadFile('https://hms.udd.gov.taipei/api/BigData/project', dir('taipei-hms-bigdata-project.json'), { force }));
  },
  async check() {
    for (const city of CITIES) {
      const rows = readList(city.code);
      const done = rows.filter((r) => r.execute_status_description === '已完工');
      const units = (rs: ScheduleRow[]) => rs.reduce((s, r) => s + (Number(r.household_num) || 0), 0);
      const in2015to2025 = done.filter((r) => {
        const y = rocSlashDateYear(r.strEndDate);
        return y !== undefined && y >= 2015 && y <= 2025;
      });
      const towns = new Set<string>();
      let withCoords = 0;
      for (const r of rows) {
        const f = dir('nlma-portal-dashboard', `${r.setupplan_guid}.json`);
        if (!fs.existsSync(f)) continue;
        const d = (JSON.parse(fs.readFileSync(f, 'utf8')) as { d?: { Data?: { TownCode?: string; SetupplanPointList?: unknown[] } } }).d?.Data;
        if (d?.TownCode) towns.add(d.TownCode);
        if ((d?.SetupplanPointList?.length ?? 0) > 0) withCoords++;
      }
      console.log(`${city.name}: ${rows.length} projects (${done.length} completed, ${rows.length - done.length} under construction); ` +
        `units ${units(done)} completed + ${units(rows) - units(done)} under construction; ` +
        `${in2015to2025.length} completed in 2015–2025; ${towns.size} districts; ${withCoords} with coordinates`);
    }
  },
};
