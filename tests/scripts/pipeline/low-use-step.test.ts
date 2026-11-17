import { describe, expect, it } from 'vitest';
import { createContext, memoryLogger } from '../../../scripts/pipeline/context.ts';
import { lowUseFiles, parseLowUse, parseLowUseText, lowUsePeriod } from '../../../scripts/pipeline/parsers/low-use.ts';
import { lowUseStep } from '../../../scripts/pipeline/low-use.ts';
import { MemoryRawReader, type RawReader, type TextEncoding } from '../../../scripts/pipeline/raw-reader.ts';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import type { BuildState } from '../../../scripts/pipeline/run.ts';

type Row = readonly [zh: string, count: number, rate: number];

const XINYI = '63000020';
const SONGSHAN = '63000010';
const zhOf = (code: string): string => (DISTRICTS.find((d) => d.code === code) as { zh: string }).zh;

/** Header-only files for all 34 current-method paths, with the given rows per period label. */
function fixture(periods: Record<string, readonly Row[]>): Record<string, string> {
  const files: Record<string, string> = {};
  for (const path of lowUseFiles()) {
    const m = /current-(\d{3}(?:H[12])?)-(63000|65000)\.csv$/.exec(path) as RegExpExecArray;
    const label = m[1] as string;
    const cityPrefix = m[2] === '63000' ? '臺北市' : '新北市';
    const lines = [`縣市,鄉鎮市區,${label}宅數,${label}比率(%)`];
    for (const [zh, count, rate] of periods[label] ?? []) {
      if (zh.startsWith(cityPrefix)) lines.push(`${cityPrefix},${zh.slice(3)},${count},${rate}`);
    }
    files[path] = `\uFEFF${lines.join('\n')}\n`;
  }
  return files;
}

/** Throws when any `moi-low-use-original-*` file is requested. */
class NoOriginalReader implements RawReader {
  readonly inner: MemoryRawReader;
  constructor(files: Record<string, string>) {
    this.inner = new MemoryRawReader(files);
  }
  private guard(p: string): void {
    if ((p.split('/').pop() ?? '').startsWith('moi-low-use-original-')) throw new Error(`original file requested: ${p}`);
  }
  list(dir: string): readonly string[] { return this.inner.list(dir); }
  exists(p: string): boolean { this.guard(p); return this.inner.exists(p); }
  readBytes(p: string): Buffer { this.guard(p); return this.inner.readBytes(p); }
  readText(p: string, e?: TextEncoding): string { this.guard(p); return this.inner.readText(p, e); }
  display(p: string, z?: string): string { return this.inner.display(p, z); }
}

function runStep(files: Record<string, string>, reader?: RawReader): BuildState {
  const ctx = createContext({ reader: reader ?? new MemoryRawReader(files), logger: memoryLogger() });
  const state = { summaries: [], notes: [] } as unknown as BuildState;
  lowUseStep().run(ctx, state);
  return state;
}

const others = (except: readonly string[]): Row[] =>
  DISTRICTS.filter((d) => !except.includes(d.code)).map((d): Row => [d.zh, 10, 1]);

describe('low-use parser', () => {
  it('maps ROC 104 to 2015H2, skips the city total row, reads the rate as a percentage', () => {
    const text = '\uFEFF縣市,鄉鎮市區,104宅數,104比率(%)\n臺北市,信義區,3000,3.1\n臺北市,全區,9999,9.9\n';
    expect(lowUsePeriod('104')).toBe('2015H2');
    expect(lowUsePeriod('110H1')).toBe('2021H1');
    expect(parseLowUseText(text, 'low-use/moi-low-use-current-104-63000.csv')).toEqual([
      { period: '2015H2', districtCode: XINYI, count: 3000, ratePercent: 3.1 },
    ]);
  });

  it('rejects an unknown header and an unknown file name', () => {
    expect(() => parseLowUseText('a,b,c,d\n', 'low-use/moi-low-use-current-104-63000.csv')).toThrow();
    expect(() => parseLowUseText('', 'low-use/moi-low-use-original-104-63000.csv')).toThrow();
  });

  it('lists 34 current-method files and no original file', () => {
    const files = lowUseFiles();
    expect(files).toHaveLength(34);
    expect(files.some((f) => f.includes('original'))).toBe(false);
    expect(parseLowUse(new MemoryRawReader(fixture({})))).toEqual([]);
  });
});

describe('lowUseStep', () => {
  const periods = {
    '104': [[zhOf(XINYI), 3000, 3.1]] as Row[],
    '108': [[zhOf(XINYI), 3741, 4.97]] as Row[],
    '110H1': [[zhOf(SONGSHAN), 100, 1.5]] as Row[],
    '114H2': others([XINYI]),
  };

  it('places values at Reference_Quarters with dataPeriod; other quarters stay null', () => {
    const s = runStep(fixture(periods));
    const count = s.lowUseHousingCount?.[XINYI] ?? [];
    expect(count).toHaveLength(44);
    expect(count[3]).toEqual({ value: 3000, estimated: false, dataPeriod: '2015H2' }); // 2015Q4
    expect(count[1]).toEqual({ value: null, estimated: false }); // 2015Q2
    expect(count[0]).toEqual({ value: null, estimated: false }); // 2015Q1, no period covers it
    expect(count[19]).toEqual({ value: 3741, estimated: false, dataPeriod: '2019H2' }); // 2019Q4
    expect(s.lowUseHousingRate?.[XINYI]?.[19]).toEqual({ value: 4.97, estimated: false, dataPeriod: '2019H2' });
    expect(count[25]).toEqual({ value: null, estimated: false }); // 2021Q2: Xinyi has no 2021H1 value
    expect(s.lowUseHousingCount?.[SONGSHAN]?.[25]).toEqual({ value: 100, estimated: false, dataPeriod: '2021H1' });
    expect(s.lowUse?.periodsPresent).toEqual(['2015H2', '2019H2', '2021H1', '2025H2']);
    expect(s.lowUse?.missing).toContainEqual({ district: XINYI, period: '2021H1' });
    expect(s.lowUse?.missing).toContainEqual({ district: XINYI, period: '2025H2' });
    expect(s.lowUse?.dataGaps).toEqual([]);
  });

  it('never opens an original file; the built value is the current-method value', () => {
    const files = {
      ...fixture(periods),
      'low-use/moi-low-use-original-108-63000.csv': '\uFEFF縣市,鄉鎮市區,108宅數,108比率(%)\n臺北市,信義區,4006,5.32\n',
    };
    const s = runStep(files, new NoOriginalReader(files));
    expect(s.lowUseHousingCount?.[XINYI]?.[19]).toEqual({ value: 3741, estimated: false, dataPeriod: '2019H2' });
    expect(s.lowUseHousingRate?.[XINYI]?.[19]?.value).toBe(4.97);
  });

  it('a district with no value in any period has 44 null records, is on the gap list, and the build continues', () => {
    const s = runStep(fixture({ '110H1': others([SONGSHAN]) }));
    expect(s.lowUse?.dataGaps).toEqual([SONGSHAN]);
    expect(s.lowUseHousingCount?.[SONGSHAN]).toEqual(Array.from({ length: 44 }, () => ({ value: null, estimated: false })));
    expect(s.notes.join()).toContain(SONGSHAN);
  });

  it('continues with exactly 5 such districts and stops with 6, listing the 6 codes', () => {
    const codes = DISTRICTS.map((d) => d.code);
    const five = codes.slice(0, 5);
    const s = runStep(fixture({ '110H1': others(five) }));
    expect(s.lowUse?.dataGaps).toEqual(five);

    const six = codes.slice(0, 6);
    let error: unknown;
    try {
      runStep(fixture({ '110H1': others(six) }));
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toMatch(/low-use-too-many-gaps/);
    expect((error as { details: string[] }).details.join()).toContain(six.join(', '));
  });
});
