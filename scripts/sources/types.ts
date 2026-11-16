/** Shared shape of one raw-data source. Each source can download its raw files and check coverage. */

export interface SourceOptions {
  /** Re-download files that already exist. */
  readonly force: boolean;
  /** Source-specific flags passed on the command line as --key or --key=value. */
  readonly flags: Readonly<Record<string, string | true>>;
}

export interface Source {
  /** Short id used on the command line, e.g. "income". */
  readonly id: string;
  /** One-line description shown by `--help`. */
  readonly title: string;
  /** Downloads raw files into data/raw/. Resumable: existing files are skipped unless `force`. */
  download(options: SourceOptions): Promise<void>;
  /** Prints a coverage report for the files already in data/raw/. Downloads nothing. */
  check(options: SourceOptions): Promise<void>;
}

/** Prints a download result line in a consistent format. */
export function logResult(label: string, result: { status: string; bytes?: number; error?: string }): void {
  const detail = result.status === 'failed' ? `FAILED: ${result.error}` : `${result.status} (${result.bytes} bytes)`;
  console.log(`  ${label}: ${detail}`);
}
