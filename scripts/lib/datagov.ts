/** Access to data.gov.tw dataset metadata (cached in data/raw/_meta/). */
import fs from 'node:fs';
import { getText } from './http.ts';
import { raw } from './paths.ts';

export interface DatagovResource {
  readonly resourceDescription: string;
  readonly resourceFormat: string;
  readonly resourceDownloadUrl: string;
}

export interface DatagovDataset {
  readonly datasetId: number;
  readonly title: string;
  readonly license: string;
  readonly modifiedDate: string;
  readonly distribution: readonly DatagovResource[];
}

/** Fetches (or reads the cached copy of) the metadata of one data.gov.tw dataset. */
export async function datasetMeta(id: number, refresh = false): Promise<DatagovDataset> {
  const file = raw('_meta', `datagov-${id}.json`);
  if (refresh || !fs.existsSync(file)) {
    const text = await getText(`https://data.gov.tw/api/v2/rest/dataset/${id}`);
    fs.mkdirSync(raw('_meta'), { recursive: true });
    fs.writeFileSync(file, text);
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { success: boolean; result: DatagovDataset };
  if (!parsed.success) throw new Error(`data.gov.tw dataset ${id}: request failed`);
  return parsed.result;
}

/** Removes any `api_key=` query value so keys embedded in catalog URLs are never logged. */
export function redactKey(url: string): string {
  return url.replace(/api_key=[^&]+/g, 'api_key=<KEY>');
}
