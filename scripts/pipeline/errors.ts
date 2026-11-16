/**
 * Error types of the data pipeline. Classes use plain field declarations and constructor assignments
 * (no parameter properties) so Node can strip the types.
 *
 * Every error has `details`: extra lines the runner prints below the one-line message.
 */

export class PipelineError extends Error {
  readonly details: readonly string[];

  constructor(message: string, details: readonly string[] = []) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

/** A parser found a row or header it cannot read. `file` may contain `!entry` for ZIP members. */
export class ParseError extends PipelineError {
  readonly file: string;
  /** 1-based row number, or undefined when the problem is not tied to a row. */
  readonly row: number | undefined;
  readonly expected: readonly string[];
  readonly found: readonly string[];

  constructor(
    file: string,
    row: number | undefined,
    expected: readonly string[],
    found: readonly string[],
    reason = 'unexpected content',
  ) {
    const where = row === undefined ? file : `${file} row ${row}`;
    super(`${where}: ${reason}`, [
      `expected columns: ${expected.join(', ')}`,
      `found columns: ${found.join(', ')}`,
    ]);
    this.file = file;
    this.row = row;
    this.expected = expected;
    this.found = found;
  }
}

/** An indicator builder broke a data rule. */
export class DataError extends PipelineError {
  /** What the rule applies to: district code, city, quarter, month, station or project guid. */
  readonly subject: string;

  constructor(rule: string, subject: string, details: readonly string[] = []) {
    super(`${rule}: ${subject}`, details);
    this.subject = subject;
  }
}

export interface MissingInput {
  /** Repository-relative path. */
  readonly path: string;
  /** Download id for `node scripts/download.ts <id>`; undefined for committed files. */
  readonly downloadId?: string;
}

export class MissingInputsError extends PipelineError {
  readonly missing: readonly MissingInput[];

  constructor(missing: readonly MissingInput[]) {
    super(
      `${missing.length} required input file${missing.length === 1 ? ' is' : 's are'} missing`,
      missing.map((m) =>
        m.downloadId === undefined
          ? `${m.path} (committed file, restore it from the repository)`
          : `${m.path}: node scripts/download.ts ${m.downloadId}`,
      ),
    );
    this.missing = missing;
  }
}

export interface ValidationIssue {
  readonly file: string;
  readonly path: string;
  readonly rule: string;
  readonly message: string;
}

export class ValidationFailedError extends PipelineError {
  readonly errors: readonly ValidationIssue[];

  constructor(errors: readonly ValidationIssue[]) {
    super(
      `validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}`,
      errors.map((e) => `${e.file} ${e.path}: ${e.rule}: ${e.message}`),
    );
    this.errors = errors;
  }
}

export interface BannedTermHit {
  readonly term: string;
  /** 1-based line number in the checked text. */
  readonly line: number;
}

export class BannedTermError extends PipelineError {
  readonly hits: readonly BannedTermHit[];

  constructor(hits: readonly BannedTermHit[]) {
    super(
      `${hits.length} banned term${hits.length === 1 ? '' : 's'} found`,
      hits.map((h) => `line ${h.line}: "${h.term}"`),
    );
    this.hits = hits;
  }
}

/** A file write or rename failed. Raised after rollback. */
export class WriteError extends PipelineError {
  readonly file: string;

  constructor(file: string, reason: string) {
    super(`could not write ${file}: ${reason}`);
    this.file = file;
  }
}
