/**
 * Shared loader of the real-price registration season files, used by the sale price, price-to-income and
 * rent builders. Reads every `lvr/{104S1..115S3}_{a,f}_lvr_land_{a|c}.csv` of one kind through the reader,
 * removes duplicate `編號` values across all files, and applies the qualifying filter.
 */
import type { BuildContext } from '../context.ts';
import { lvrFiles } from '../manifest.ts';
import {
  dedupeById,
  filterLvr,
  formatExclusions,
  parseLvrCsv,
  type ExclusionCounts,
  type LvrFile,
  type LvrKind,
  type LvrRecord,
} from '../parsers/lvr.ts';

/** Repository-relative (under data/raw/) paths of the files of one kind, in manifest order. */
export function lvrPaths(kind: LvrKind): string[] {
  const suffix = kind === 'sale' ? '_lvr_land_a.csv' : '_lvr_land_c.csv';
  return lvrFiles().filter((p) => p.endsWith(suffix));
}

export interface LvrLoad {
  /** De-duplicated records, before the qualifying filter. */
  readonly records: readonly LvrRecord[];
  readonly duplicates: number;
  /** Records that pass `classifyLvr` (for sales: unit price > 0; for rentals: rent and area > 0). */
  readonly qualifying: readonly LvrRecord[];
  readonly exclusions: ExclusionCounts;
}

/** Reads, parses and de-duplicates all files of one kind. */
export function readLvrFiles(ctx: BuildContext, kind: LvrKind): { records: LvrRecord[]; duplicates: number } {
  const files: LvrFile[] = lvrPaths(kind).map((p) => {
    const display = ctx.reader.display(p);
    return { file: display, records: parseLvrCsv(ctx.reader.readText(p), display, kind) };
  });
  return dedupeById(files);
}

/** `readLvrFiles` followed by the qualifying filter and exclusion counts. */
export function loadLvr(ctx: BuildContext, kind: LvrKind): LvrLoad {
  const { records, duplicates } = readLvrFiles(ctx, kind);
  const { qualifying, exclusions } = filterLvr(records, duplicates);
  return { records, duplicates, qualifying, exclusions };
}

/**
 * Sales that count toward a median total price (Requirements 10.2, 19.2): qualifying sales (the sale price
 * filter of Requirement 8.2-8.6 already applied) whose 總價元 is greater than 0 and that have a district and a
 * quarter. The only implementation of this condition; the median total price and price-to-income builders
 * both call it (Requirement 19.6).
 */
export function totalPriceSales(qualifying: readonly LvrRecord[]): LvrRecord[] {
  return qualifying.filter((r) => r.totalPrice > 0 && r.districtCode !== undefined && r.quarter !== undefined);
}

/** Note lines `<kind> records excluded, <reason>: <n>` in fixed reason order (Requirement 8.5). */
export function exclusionNotes(kind: LvrKind, exclusions: Readonly<ExclusionCounts>): string[] {
  return formatExclusions(exclusions).map((line) => `${kind} records excluded, ${line}`);
}
