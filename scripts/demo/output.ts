// Demo_Script output (game-ui task 10.6, Requirements 14.6, 14.23, 14.25).
// Renders the stdout report. The file text itself comes from `renderDemoModule` (run-demo.ts, decision G10).

import type { DemoResult } from './run-demo.ts';

export { renderDemoModule } from './run-demo.ts';

/** Report lines of one run: success (per-step lines, step reached, summary) or failure (14.6, 14.23). Deterministic. */
export function renderReport(result: DemoResult): string[] {
  const lines: string[] = [...result.report];
  if (result.ok) {
    lines.push(`Fallback_Step reached: ${result.summary.fallbackStep}`);
    lines.push(`Selected_District: ${result.summary.rentBurden.district}`);
    lines.push('Demo_Summary:');
    lines.push(...result.summaryText.trimEnd().split('\n'));
    return lines;
  }
  lines.push(`Demo_Script failed: ${result.message}`);
  if (result.list !== null) lines.push(`List: ${result.list}`);
  if (result.adjustment !== null) {
    const a = result.adjustment;
    lines.push(`Adjustment: ${a.quarter} ${a.tool}.${a.field}/${a.area} ${a.kind}${a.kind === 'value' ? ` ${a.value}` : ''}`);
  }
  if (result.quarter !== null) lines.push(`Quarter: ${result.quarter}`);
  if (result.lastStep !== null) lines.push(`Last Fallback_Step: ${result.lastStep}`);
  for (const f of result.failures) lines.push(`Failed: ${f}`);
  return lines;
}
