import { describe, expect, it } from 'vitest';
import { createContext, memoryLogger } from '../../../scripts/pipeline/context.ts';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';
import { DEFAULT_STEPS, createState } from '../../../scripts/pipeline/run.ts';
import { policyStep } from '../../../scripts/pipeline/policy/step.ts';
import { POLICY_SERIES_SPECS } from '../../../scripts/pipeline/registry/indicators.ts';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';

const e3010 = JSON.stringify({ resultTable: [['縣市', '104Q1', '104Q2'], ['臺北市', '1,000.00', '2,000.00'], ['新北市', '5', '6']] });
const amount169800 = ['年,地區,租金補貼戶數計,租金補貼金額計', '112,臺北市,2000,9398', '112,新北市,6000,21888'].join('\n');
const houseTax = [
  '地區別,房屋稅',
  ...[104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114].flatMap((y) => [`${y}年/ 臺北市,4000`, `${y}年/ 新北市(改制後),8000`]),
].join('\n');
const emptyList = JSON.stringify({ Data: { data: [{ setupplan_guid: 'G1', city_name: '臺北市', execute_status_description: '興建中', household_num: '12', strStartDate: '104/05/05', strEndDate: '' }] } });
const detail = JSON.stringify({ d: { Data: { SetupplanGuid: 'G1', CityCode: 'A', TownCode: '63000020' } } });

const committed: Record<string, string> = {
  'data/config/holding-tax-rates.csv': [
    'city,effective_date,lowest_rate,highest_rate,legal_text,article_or_version,source,url',
    'statutory,2014-06-06,1.5,3.6,Act,Art. 5,policy/house-tax-act,',
    'Taipei,2014-07-01,2.4,3.6,Ordinance,Art. 4,policy/taipei-ordinance,',
    'New Taipei,2017-07-01,2.4,2.4,Ordinance,Art. 2,policy/ntpc-ordinance,',
  ].join('\n'),
  'data/config/commuter-pass-products.csv': [
    'city,product,start_date,price_twd,source,url',
    'Taipei,pass,2018-04-16,1280,policy/trtc-products,',
    'New Taipei,pass,2018-04-16,1280,policy/trtc-products,',
  ].join('\n'),
  'data/config/sublease-phases.csv': [
    'city,channel,phase,start_date,total_units,as_of,source,url',
    'Taipei,city,1,2017-01-01,100,2026-10-31,policy/moi-b5010,',
    'New Taipei,city,1,2017-01-01,200,2026-10-31,policy/moi-b5010,',
  ].join('\n'),
};

function reader(): MemoryRawReader {
  return new MemoryRawReader({
    'policy/housing/pip-e3010-6_1_3-taipei-newtaipei.json': e3010,
    'policy/housing/pip-e3010-6_3_1-taipei-newtaipei.json': e3010,
    'policy/housing/datagov-169800.csv': amount169800,
    'policy/housing/datagov-6742.csv': houseTax,
    'social-housing/nlma-portal-GetScheduleData-A.json': emptyList,
    'social-housing/nlma-portal-GetScheduleData-F.json': JSON.stringify({ Data: { data: [] } }),
    'social-housing/nlma-portal-dashboard/G1.json': detail,
  });
}

describe('policyStep', () => {
  it('builds the ten series of the registry into state.policyTrack and is part of DEFAULT_STEPS', () => {
    const ctx = createContext({ reader: reader(), logger: memoryLogger() });
    const state = createState();
    state.population = Object.fromEntries(DISTRICTS.map((d) => [d.code, ctx.quarters.map(() => ({ value: 100, estimated: false as const }))]));
    policyStep((p) => committed[p]!).run(ctx, state);

    const track = state.policyTrack!;
    expect(Object.keys(track).sort()).toEqual(POLICY_SERIES_SPECS.map((s) => s.id).sort());
    expect(track.socialHousingUnitsStarted['63000020']![1]!.value).toBe(12); // 104/05/05 = 2015Q2
    expect(track.rentSubsidyHouseholds.Taipei.slice(0, 3).map((r) => r.value)).toEqual([2000, 4000, 0]);
    expect(track.rentSubsidyAmountPerHousehold.Taipei[0]!.value).toBe(4699);
    expect(track.holdingTaxRateLowestTier['New Taipei'][0]).toMatchObject({ value: 1.5, estimated: true });
    expect(track.houseTaxRevenue.Taipei.map((r) => r.value).slice(0, 4)).toEqual([1000, 1000, 1000, 1000]);
    expect(track.commuterPassPrice.Taipei[13]!.value).toBe(1280);
    expect(state.policyNotes).toEqual(['social housing starts: no projects excluded']);
    expect(DEFAULT_STEPS.map((s) => s.name)).toContain('policy-track');
  });

  it('stops with a DataError when the population step has not run', () => {
    const ctx = createContext({ reader: reader(), logger: memoryLogger() });
    expect(() => policyStep((p) => committed[p]!).run(ctx, createState())).toThrow(DataError);
  });
});
