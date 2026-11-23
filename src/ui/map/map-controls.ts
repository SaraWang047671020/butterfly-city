// Map controls as plain DOM blocks outside the 3D canvas: indicator switch, legend, indicator text and the
// Price_To_Income label. Each block is independent and is mounted into a host (see mountComponent).
// No SVG, no d3-geo, no page layout. Colours come from tokens only (inline `var(--token)`).

import { MAP_INDICATOR_IDS } from '../../types/save.ts';
import type { MapIndicatorId } from '../../types/save.ts';
import type { MapViewModel, UiActions } from '../../types/view.ts';
import { setAttr, setText } from '../component.ts';
import type { Component, ComponentFactory } from '../component.ts';
import { fillTemplate, UI_STRINGS, quarterLabel, unitLabel } from '../strings.ts';
import { classColorToken, INDICATOR_CLASSES } from './indicator-classes.ts';
import '../../styles/map-controls.css';

const M = UI_STRINGS.mapControls;
const INDICATOR_NAMES = UI_STRINGS.districtPanel.mapIndicators;

/** What the map controls read. A `MapViewModel` satisfies it. */
export interface MapControlsView {
  readonly indicator: MapIndicatorId;
  readonly labelMode: MapViewModel['labelMode'];
  readonly quarter: MapViewModel['quarter'];
  readonly legend: MapViewModel['legend'];
  readonly districts: readonly { readonly dataPeriod: string | null }[];
}

let instanceCounter = 0;

/** Formats a bound with the indicator's decimals; a minus sign is U+2212. */
function formatBound(value: number, decimals: number): string {
  const text = Math.abs(value).toFixed(decimals);
  return value < 0 && Number(text) !== 0 ? `\u2212${text}` : text;
}

/** Text of each Indicator_Class: open below, closed between bounds, open above. */
export function legendClassTexts(bounds: readonly number[], unit: string, decimals: number): string[] {
  const out: string[] = [];
  const f = (v: number): string => formatBound(v, decimals);
  if (bounds.length === 0) return out;
  out.push(fillTemplate(M.classBelow, { bound: f(bounds[0]!), unit }));
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    out.push(fillTemplate(M.classBetween, { low: f(bounds[i]!), high: f(bounds[i + 1]!), unit }));
  }
  out.push(fillTemplate(M.classAbove, { bound: f(bounds[bounds.length - 1]!), unit }));
  return out;
}

/** Sorted distinct `dataPeriod` values of the districts that have one. */
export function distinctPeriods(districts: readonly { readonly dataPeriod: string | null }[]): string[] {
  const set = new Set<string>();
  for (const d of districts) if (d.dataPeriod !== null) set.add(d.dataPeriod);
  return [...set].sort();
}

/** Indicator switch: 5 radio inputs in one group. Arrow keys, Tab and Space work natively. */
export const createIndicatorSwitch: ComponentFactory<MapControlsView> = (doc: Document, actions: UiActions) => {
  instanceCounter += 1;
  const groupName = `map-indicator-${instanceCounter}`;
  const root = doc.createElement('fieldset');
  root.className = 'map-switch';
  const legend = doc.createElement('legend');
  legend.className = 'map-switch__legend';
  legend.textContent = M.switchLabel;
  root.appendChild(legend);

  const inputs = new Map<MapIndicatorId, HTMLInputElement>();
  for (const id of MAP_INDICATOR_IDS) {
    const label = doc.createElement('label');
    label.className = 'map-switch__option';
    const input = doc.createElement('input');
    input.type = 'radio';
    input.name = groupName;
    input.value = id;
    input.className = 'map-switch__input';
    input.addEventListener('change', () => {
      if (input.checked) actions.setMapIndicator(id);
    });
    const text = doc.createElement('span');
    text.className = 'map-switch__text';
    text.textContent = INDICATOR_NAMES[id];
    label.append(input, text);
    root.appendChild(label);
    inputs.set(id, input);
  }

  return {
    root,
    update(view: MapControlsView): void {
      for (const [id, input] of inputs) input.checked = id === view.indicator;
    },
  };
};

/** Legend: one swatch per Indicator_Class with bounds and unit, the "no value" swatch, and data periods. */
export const createLegend: ComponentFactory<MapControlsView> = (doc: Document): Component<MapControlsView> => {
  const root = doc.createElement('section');
  root.className = 'map-legend';
  const heading = doc.createElement('h3');
  heading.className = 'map-legend__heading';
  const list = doc.createElement('ul');
  list.className = 'map-legend__list';
  const period = doc.createElement('p');
  period.className = 'map-legend__period';
  root.append(heading, list, period);

  function addItem(swatchClass: string, token: string, text: string): void {
    const li = doc.createElement('li');
    li.className = 'map-legend__item';
    const swatch = doc.createElement('span');
    swatch.className = `map-legend__swatch ${swatchClass}`;
    swatch.setAttribute('aria-hidden', 'true');
    swatch.style.setProperty('--swatch-color', `var(${token})`);
    const label = doc.createElement('span');
    label.className = 'map-legend__label';
    label.textContent = text;
    li.append(swatch, label);
    list.appendChild(li);
  }

  let lastKey = '';
  return {
    root,
    update(view: MapControlsView): void {
      const { legend } = view;
      const id = legend.indicator;
      const name = INDICATOR_NAMES[id];
      setText(heading, fillTemplate(M.legendLabel, { indicator: name }));
      const periods = id === 'lowUseHousingRate' ? distinctPeriods(view.districts) : [];
      const key = `${id}|${legend.unit}|${legend.decimals}|${legend.bounds.join(',')}`;
      if (key !== lastKey) {
        lastKey = key;
        list.textContent = '';
        const texts = legendClassTexts(legend.bounds, unitLabel(legend.unit), legend.decimals);
        texts.forEach((text, i) => addItem('', classColorToken(id, i), text));
        // A null value is "No data" (Low_Use_Housing_Rate) or "no value", never class 0.
        addItem(
          'map-legend__swatch--nodata',
          '--color-nodata-fill',
          id === 'lowUseHousingRate' ? UI_STRINGS.range.noData : UI_STRINGS.range.noValue,
        );
      }
      period.hidden = periods.length === 0;
      setText(period, periods.length === 0 ? '' : fillTemplate(M.dataPeriods, { periods: periods.join(', ') }));
    },
  };
};

/** Indicator text: the Displayed_Quarter (or "Real data, 2015Q1") and the name and unit of the indicator. */
export const createIndicatorText: ComponentFactory<MapControlsView> = (doc: Document): Component<MapControlsView> => {
  const root = doc.createElement('div');
  root.className = 'map-text';
  root.setAttribute('role', 'status');
  const indicator = doc.createElement('p');
  indicator.className = 'map-text__indicator';
  const quarter = doc.createElement('p');
  quarter.className = 'map-text__quarter';
  root.append(indicator, quarter);
  return {
    root,
    update(view: MapControlsView): void {
      setText(
        indicator,
        fillTemplate(M.textIndicator, {
          indicator: INDICATOR_NAMES[view.indicator],
          unit: unitLabel(INDICATOR_CLASSES[view.indicator].unit),
        }),
      );
      let text: string;
      if (view.labelMode === 'real-2015Q1') text = UI_STRINGS.turnBar.realData2015Q1;
      else if (view.quarter === null) text = M.textNoQuarter;
      else text = fillTemplate(M.textQuarter, { quarter: quarterLabel(view.quarter) });
      setText(quarter, text);
    },
  };
};

/** Price_To_Income label (Requirement 3.7). Visible only while that indicator is selected. */
export const createPriceToIncomeLabel: ComponentFactory<MapControlsView> = (doc: Document): Component<MapControlsView> => {
  const root = doc.createElement('p');
  root.className = 'map-price-label';
  root.textContent = UI_STRINGS.districtPanel.priceNotChanged;
  return {
    root,
    update(view: MapControlsView): void {
      root.hidden = view.indicator !== 'priceToIncome';
      setAttr(root, 'aria-hidden', root.hidden ? 'true' : null);
    },
  };
};

/** The four blocks in one self-contained wrapper that a parent can place anywhere (city-3d Requirement 9). */
export const createMapControls: ComponentFactory<MapControlsView> = (doc: Document, actions: UiActions): Component<MapControlsView> => {
  const root = doc.createElement('div');
  root.className = 'map-controls';
  const parts = [
    createIndicatorSwitch(doc, actions),
    createIndicatorText(doc, actions),
    createLegend(doc, actions),
    createPriceToIncomeLabel(doc, actions),
  ];
  root.append(...parts.map((p) => p.root));
  return {
    root,
    update(view: MapControlsView): void {
      for (const p of parts) p.update(view);
    },
  };
};
