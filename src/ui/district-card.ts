// District_Card (play-loop Requirement 7.4, 7.5; approved design 2026-11-23): a small card at the selected district
// with the values the District_Panel shows for the same district and quarter (rent burden, commute time and their
// difference from the comparison value), the player's social housing there, and Walk here / Open in report / Close.
// The outer container positions it (near the district on wide screens, docked on narrow screens).
import type { ConstructionRowView, DistrictPanelView, PanelRowView, UiActions } from '../types/view.ts';
import { setText, type Component } from './component.ts';
import { formatNumber } from './format/number.ts';
import { cityLabel, fillTemplate, quarterLabel, UI_STRINGS, unitLabel } from './strings.ts';

const K = UI_STRINGS.districtCard;

export interface DistrictCardProps {
  readonly panel: DistrictPanelView;
  readonly construction: readonly ConstructionRowView[];
}

export interface DistrictCard extends Component<DistrictCardProps> {
  readonly root: HTMLElement;
  /** The district the card shows, or null when it is hidden. */
  shown(): string | null;
}

/** Value and difference line of one panel row, in the District_Panel's numbers. Pure; exported for tests. */
export function cardRow(row: PanelRowView): { readonly value: string; readonly diff: string | null } {
  const unit = unitLabel(row.unit);
  const sim = row.simulated;
  const central = sim !== null ? sim.range.central : (row.realOnly?.value ?? null);
  const value = central === null ? UI_STRINGS.range.noValue : `${formatNumber(central, row.decimals)} ${unit}`.trim();
  if (sim === null || sim.comparison.value === null) return { value, diff: null };
  const d = sim.range.central - sim.comparison.value;
  const shown = Number(formatNumber(Math.abs(d), row.decimals).replace(/,/g, ''));
  const diffUnit = row.percentRow ? UI_STRINGS.districtPanel.units.percentagePoints : unit;
  if (shown === 0) return { value, diff: K.sameAsReal };
  return { value, diff: fillTemplate(d > 0 ? K.aboveReal : K.belowReal, { diff: formatNumber(Math.abs(d), row.decimals), unit: diffUnit }) };
}

export function createDistrictCard(doc: Document, actions: UiActions, on: { readonly walk: (code: string) => void; readonly report: (opener: HTMLElement) => void }): DistrictCard {
  void actions;
  const root = doc.createElement('section');
  root.className = 'ui-district-card';
  root.hidden = true;
  const head = doc.createElement('div');
  head.className = 'ui-district-card__head';
  const titles = doc.createElement('div');
  const name = doc.createElement('h2');
  name.className = 'ui-district-card__name';
  name.id = 'ui-district-card-name';
  root.setAttribute('aria-labelledby', name.id);
  const sub = doc.createElement('p');
  sub.className = 'ui-district-card__sub';
  titles.append(name, sub);
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'ui-district-card__close';
  close.textContent = '×';
  close.setAttribute('aria-label', K.close);
  head.append(titles, close);
  const rows = doc.createElement('dl');
  rows.className = 'ui-district-card__rows';
  const housing = doc.createElement('p');
  housing.className = 'ui-district-card__housing';
  const buttons = doc.createElement('div');
  buttons.className = 'ui-district-card__buttons';
  const walk = doc.createElement('button');
  walk.type = 'button';
  walk.className = 'dialog__button dialog__button--primary ui-walk-action';
  walk.textContent = K.walk;
  const report = doc.createElement('button');
  report.type = 'button';
  report.className = 'dialog__button';
  report.textContent = K.report;
  buttons.append(walk, report);
  root.append(head, rows, housing, buttons);

  let code: string | null = null;
  let closedFor: string | null = null;
  close.addEventListener('click', () => {
    closedFor = code;
    root.hidden = true;
  });
  walk.addEventListener('click', () => {
    if (code !== null) on.walk(code);
  });
  report.addEventListener('click', () => on.report(report));

  const ROWS = ['rentBurden', 'commuteTime'] as const;

  return {
    root,
    shown: () => (root.hidden ? null : code),
    update({ panel, construction }) {
      const d = panel.district;
      if (d === null || panel.mode === 'prompt') {
        code = null;
        root.hidden = true;
        return;
      }
      if (d.code !== code) closedFor = null;
      code = d.code;
      root.hidden = closedFor === d.code;
      setText(name, d.name);
      setText(sub, `${cityLabel(d.city)} · ${panel.mode === 'real-2015Q1' ? UI_STRINGS.turnBar.realData2015Q1 : panel.quarter === null ? '' : quarterLabel(panel.quarter)}`);
      const items: HTMLElement[] = [];
      for (const id of ROWS) {
        const row = panel.rows.find((r) => r.id === id);
        if (row === undefined) continue;
        const { value, diff } = cardRow(row);
        const dt = doc.createElement('dt');
        dt.textContent = (UI_STRINGS.districtPanel.rows as Readonly<Record<string, string>>)[id] ?? id;
        const dd = doc.createElement('dd');
        const v = doc.createElement('span');
        v.className = 'ui-district-card__value';
        v.textContent = value;
        dd.append(v);
        if (diff !== null) {
          const s = doc.createElement('span');
          s.className = 'ui-district-card__diff';
          s.textContent = diff;
          dd.append(s);
        }
        items.push(dt, dd);
      }
      rows.replaceChildren(...items);
      const mine = construction.filter((r) => r.district === d.code);
      housing.hidden = mine.length === 0;
      setText(
        housing,
        mine
          .map((r) => fillTemplate(r.difference > 0 ? K.housingMore : K.housingFewer, { units: formatNumber(Math.abs(r.difference), 0), quarter: quarterLabel(r.effect) }))
          .join(' · '),
      );
    },
  };
}
