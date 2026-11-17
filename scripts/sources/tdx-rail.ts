/**
 * TDX rail sources that need credentials: `fares` and `timetables`.
 *
 *   fares      data/raw/fares/tdx-metro-od-fare-{OP}.json   TDX Rail/Metro/ODFare/{OP}
 *              Adult single-journey station-pair fares (TWD). Each record carries a `Fares` array with
 *              `TicketType` and `FareClass`; the adult single-journey entry is selected when the file is read.
 *   timetables data/raw/timetables/tdx-timetable-{OP}.json   TDX Rail/Metro/StationTimeTable/{OP}
 *              data/raw/timetables/tdx-frequency-{OP}.json   TDX Rail/Metro/Frequency/{OP} (TRTC and NTMC only)
 *              Departure times per station and the headway of each line.
 *
 * Operators: TRTC (Taipei Metro), NTMC (New Taipei Metro: Circular Line), NTDLRT (Danhai LRT), NTALRT (Ankeng LRT).
 * Credentials come only from TDX_CLIENT_ID and TDX_CLIENT_SECRET (scripts/lib/tdx.ts). When either is absent or
 * blank the source throws before any network call and writes no file.
 */
import { raw } from '../lib/paths.ts';
import { TDX_API, openTdxSession, requireTdxCredentials, tdxDownload } from '../lib/tdx.ts';
import { logResult, type Source } from './types.ts';

export const RAIL_OPERATORS = ['TRTC', 'NTMC', 'NTDLRT', 'NTALRT'] as const;

/** One TDX download: the label, the URL and the destination path segments below data/raw/. */
export interface TdxRequest {
  readonly label: string;
  readonly url: string;
  readonly dest: readonly string[];
}

export function fareRequests(): TdxRequest[] {
  return RAIL_OPERATORS.map((op) => ({
    label: `TDX ODFare ${op}`,
    url: `${TDX_API}/ODFare/${op}?%24format=JSON`,
    dest: ['fares', `tdx-metro-od-fare-${op}.json`],
  }));
}

/** Operators for which TDX serves Frequency (it returns HTTP 400 for NTDLRT and NTALRT). */
export const FREQUENCY_OPERATORS = ['TRTC', 'NTMC'] as const;

export function timetableRequests(): TdxRequest[] {
  const stationTimeTables = RAIL_OPERATORS.map((op): TdxRequest => ({
    label: `TDX StationTimeTable ${op}`, url: `${TDX_API}/StationTimeTable/${op}?%24format=JSON`, dest: ['timetables', `tdx-timetable-${op}.json`],
  }));
  const frequencies = FREQUENCY_OPERATORS.map((op): TdxRequest => ({
    label: `TDX Frequency ${op}`, url: `${TDX_API}/Frequency/${op}?%24format=JSON`, dest: ['timetables', `tdx-frequency-${op}.json`],
  }));
  return [...stationTimeTables, ...frequencies];
}

async function run(requests: readonly TdxRequest[], force: boolean): Promise<void> {
  const credentials = requireTdxCredentials(); // throws before any network call
  const session = await openTdxSession(credentials);
  let failed = 0;
  for (const r of requests) {
    const result = await tdxDownload(session, r.url, raw(...r.dest), force);
    if (result.status === 'failed') failed++;
    logResult(r.label, result);
  }
  if (failed > 0) throw new Error(`${failed} of ${requests.length} files failed`);
}

function notChecked(id: string): () => Promise<void> {
  return async () => {
    console.log(`${id}: no coverage report (the files are read by the pipeline).`);
  };
}

export const fares: Source = {
  id: 'fares',
  title: 'Adult single-journey station-pair fares, Taipei Metro, New Taipei Metro, Danhai LRT, Ankeng LRT (TDX; needs TDX_CLIENT_ID and TDX_CLIENT_SECRET)',
  download: ({ force }) => run(fareRequests(), force),
  check: notChecked('fares'),
};

export const timetables: Source = {
  id: 'timetables',
  title: 'Station timetables and line headways of the same four operators (TDX; needs TDX_CLIENT_ID and TDX_CLIENT_SECRET)',
  download: ({ force }) => run(timetableRequests(), force),
  check: notChecked('timetables'),
};
