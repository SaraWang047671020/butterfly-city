// Accessible name of one district (Requirements 3.11, 3.15, 4.2, 4.3). Pure: no DOM.
// Used by the map shapes and by the 3D City_View.
import type { CityName } from '../../types/data-files.ts';
import type { ResultRange } from '../../types/simulation.ts';
import { formatRange } from '../format/range.ts';
import { fillTemplate, UI_STRINGS } from '../strings.ts';

export interface DistrictAccessibleNameInput {
  readonly name: string;
  readonly city: CityName;
  readonly indicator: string;
  readonly unit: string;
  readonly range: ResultRange | null;
  readonly decimals: number;
  readonly estimated: boolean;
  /** Period of a periodic value (lowUseHousingRate), appended to the name of a non-null value. */
  readonly dataPeriod?: string | null;
  /** Use the text "no data" instead of "no value" for a null value (lowUseHousingRate). */
  readonly noData?: boolean;
}

export function districtAccessibleName(input: DistrictAccessibleNameInput): string {
  const r = UI_STRINGS.range;
  const prefix = fillTemplate(r.a11yPrefix, {
    name: input.name,
    city: input.city,
    indicator: input.indicator,
  });
  const text = formatRange(input.range, input.decimals, input.unit);
  let body: string;
  if (text.kind === 'none') {
    // A null value is never read as 0 and carries no estimate suffix or data period.
    return `${prefix} ${input.noData === true ? r.noData.toLowerCase() : r.noValue}`;
  }
  if (text.kind === 'same') {
    body = fillTemplate(r.a11ySame, {
      value: text.value,
      unit: input.unit,
      sameInAll: r.sameInAll,
    });
  } else {
    body = fillTemplate(r.a11yRange, {
      value: text.central,
      unit: input.unit,
      min: text.min,
      max: text.max,
    });
  }
  let name = `${prefix} ${body.replace(/ +,/g, ',')}`;
  if (input.dataPeriod !== undefined && input.dataPeriod !== null) {
    name += fillTemplate(r.a11yDataPeriod, { period: input.dataPeriod });
  }
  if (input.estimated) name += `, ${r.estimated}`;
  return name;
}
