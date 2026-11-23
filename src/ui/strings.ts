// UI_Strings_Module (game-ui Requirement 15.3): every UI chrome string of the Game_Screen.
// Placeholders are written as {name} and filled with `fillTemplate`. Numbers are formatted by the caller.
// Text authored by the user is marked TODO(user text) and is a short placeholder until supplied.
// Not here (deferred to the 3D redesign): map region name, map indicator switch label, legend,
// district shape accessible-name forms (4.2, 4.3), map keyboard hints, Ghost_Layer text.

import type { EngineErrorCode } from '../types/simulation.ts';

/** Replaces each {name} with values[name]; an unknown name stays as written. */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

export const DISCLOSURE_TEXT =
  'Initial data and events come from real open data. Policy outcomes are simulated, not predicted.';

const ENGINE_ERROR_TEXT: Readonly<Record<EngineErrorCode, string>> = {
  'quarter-invalid': 'The quarter is not valid.',
  'no-later-quarter': 'There is no later quarter to compute.',
  'registry-duplicate': 'The model has two rules with the same id.',
  'rule-reference-missing': 'A model rule refers to a rule that does not exist.',
  'parameters-invalid': 'The parameter table has invalid entries.',
  'commute-matrix-invalid': 'The commute-time matrix is not valid.',
  'baseline-missing': 'A real baseline value is missing.',
  'baseline-invalid': 'A real baseline value is not valid.',
  'track-missing': 'A real policy value is missing.',
  'policy-value-invalid': 'A policy value is not valid.',
  'limit-exceeded': 'A policy value is outside its allowed limit.',
  'real-net-price-zero': 'A real net price is zero, so the effect cannot be computed.',
  'households-exceed-renters': 'The number of subsidised households is larger than the number of renter households.',
  'derived-input-invalid': 'An input derived from the data is not valid.',
  'event-invalid': 'An event entry is not valid.',
  'event-reference-unknown': 'An event refers to an item that does not exist.',
  'budget-exceeded': 'The annual budget is exceeded.',
  'ceiling-exceeded': 'The spending ceiling of a tool is exceeded.',
  'stock-negative': 'A housing stock would become negative.',
  'non-finite': 'A computed value is not a finite number.',
};

/** Player-facing Engine_Error text built from `code` and `details`; names no Scenario (Requirement 9.4). */
export function buildEngineErrorText(
  code: EngineErrorCode,
  details: Readonly<Record<string, string | number | boolean | null>>,
): string {
  const base = ENGINE_ERROR_TEXT[code];
  const parts = Object.entries(details).map(([k, v]) => `${k}: ${String(v)}`);
  const head = fillTemplate(UI_STRINGS.errors.engine, { code, text: base });
  return parts.length === 0 ? head : `${head} (${parts.join(', ')})`;
}

export const UI_STRINGS = {
  app: {
    title: 'Butterfly City',
    disclosure: DISCLOSURE_TEXT,
    loading: '{n} of 6 files loaded',
    retry: 'Retry',
    loadErrorLine: '{file}: {error}',
    loadErrorHeading: 'Some data files could not be loaded.',
  },

  turnBar: {
    planningQuarter: 'Planning quarter',
    displayedQuarter: 'Displayed quarter',
    turnNumber: 'Turn {n} of 44',
    noQuarterComputed: 'No quarter computed yet',
    complete: 'Simulation complete: 2015Q1 to 2025Q4',
    nextQuarter: 'Next quarter',
    fastForward: 'Fast-forward one year',
    busy: 'Computing…',
    demoLabel: 'Demo game',
    exportSaveCode: 'Export save code',
    importSaveCode: 'Import',
    realData2015Q1: 'Real data, 2015Q1',
  },

  range: {
    display: '{value} {unit} (possible range {min}–{max} {unit})',
    sameInAll: 'same in all scenarios',
    aboutControl: 'About this range',
    aboutText:
      'The possible range comes from studies that disagree on some parameters. The model is run with each set of assumptions, and the range shows the lowest and highest result. It is a scenario range, not a statistical interval.',
    why: 'Why?',
    noValue: 'no value',
    noData: 'No data',
    estimated: 'estimated',
    // Accessible names of districts (map and 3D city view).
    a11yPrefix: '{name}, {city}: {indicator}',
    a11yRange: '{value} {unit}, possible range {min} to {max}',
    a11ySame: '{value} {unit}, {sameInAll}',
    a11yDataPeriod: ', data period {period}',
    estimateMethod: 'Estimate method: {method}',
    real: 'Real',
    derivedBaseline: 'Derived baseline',
    sourceNotListed: 'source not listed',
    modelEstimate: 'model estimate',
  },

  districtPanel: {
    prompt: 'Select a district on the map or in the list.',
    listHeading: 'Districts',
    cityHeading: '{city}',
    differenceLabel: 'Difference from comparison',
    ghostSize: '1 ghost = {size} residents',
    priceNotChanged: 'House prices are not changed by policies in this version.',
    dataPeriod: 'Data period {period}',
    rows: {
      rentBurden: 'Rent burden',
      priceToIncome: 'Price-to-income ratio',
      commuteTime: 'Commute time',
      populationChange: 'Population change since 2015Q1',
      rent: 'Rent',
      population: 'Population',
      socialHousingStock: 'Social housing stock',
      mrtEntries: 'MRT entries',
      ghostCount: 'Ghost count',
    },
    units: {
      percent: '%',
      percentagePoints: 'percentage points',
      years: 'years of income',
      minutes: 'minutes',
      units: 'units',
      people: 'residents',
      ghosts: 'ghosts',
    },
    mapIndicators: {
      rentBurden: 'Rent burden',
      priceToIncome: 'Price-to-income ratio',
      commuteTime: 'Commute time',
      populationChange: 'Population change',
      lowUseHousingRate: 'Low-use housing rate',
    },
  },

  mapControls: {
    switchLabel: 'Map indicator',
    legendHeading: 'Legend',
    legendLabel: 'Legend: {indicator}',
    classBelow: 'Below {bound} {unit}',
    classBetween: '{low} to {high} {unit}',
    classAbove: '{bound} {unit} and above',
    dataPeriods: 'Data period {periods}',
    textIndicator: 'Indicator: {indicator} ({unit})',
    textQuarter: 'Displayed quarter: {quarter}',
    textNoQuarter: 'Displayed quarter: none computed yet',
  },

  policy: {
    heading: 'Policies',
    housing: 'Housing',
    transit: 'Transit',
    comingSoon: 'Coming soon',
    realValue: 'real value',
    realValueLabel: 'Real value for {quarter}',
    yourValue: 'Your value',
    unitCost: 'Unit cost (TWD)',
    lag: 'Lag (quarters)',
    lowerLimit: 'Lower limit',
    upperLimit: 'Upper limit',
    remainingCeiling: 'Remaining ceiling of this tool in {year} (TWD)',
    citation: 'Source',
    noSource: 'No source recorded',
    parameterStatus: {
      verified: 'Checked against the original source',
      secondary: 'From a secondary source',
      gap: 'Assumption: no direct source found',
    },
    noRealValue: 'No real value recorded',
    selectDistrict: 'Select a district to edit this field.',
    noCommuterPass: 'No commuter pass product existed in this quarter',
    cityYearTotal: 'City total over the 4 quarters of {year}',
    setToReal: 'Set to real value',
    apply: 'Apply',
    budgetNote: 'Budget covers the tools currently simulated',
    annualBudget: 'Annual budget {year}',
    committed: 'Committed',
    remaining: 'Remaining',
    fixedQuarter: 'Computed quarters are fixed. Changes apply from {quarter}.',
    breaksLower: 'The value is below the lower limit of {limit} {unit}.',
    breaksUpper: 'The value is above the upper limit of {limit} {unit}.',
    limitReason: 'Reason: {reason}',
    budgetAnnualExceeded: 'In {year}, the annual budget of {budget} TWD is exceeded by {over} TWD.',
    budgetCeilingExceeded: 'In {year}, the ceiling of this tool of {budget} TWD is exceeded by {over} TWD.',
    rangeEngineError: 'This happens in one of the parameter assumptions of the possible range.',
    invalidInteger: '{field}: enter a whole number (digits only, optional leading minus sign).',
    invalidNumber: '{field}: enter a number (digits, at most one decimal point, optional leading minus sign).',
    checking: 'Checking…',
    carriedValueStop:
      '{field} ({area}) holds {value}, which breaks {rule} in {quarter}. Computing stopped before that quarter.',
    fields: {
      'socialHousing.unitsStarted': 'Social housing units started',
      'rentSubsidy.households': 'Subsidised households',
      'rentSubsidy.amount': 'Subsidy per household per month',
      'commuterPass.subsidy': 'Subsidy per pass per month',
    },
    tools: {
      socialHousing: 'Social housing construction',
      sublease: 'Sublease and rental management program',
      rentSubsidy: 'Rent subsidy',
      holdingTax: 'Vacant and multiple-home holding tax',
      commuterPass: 'Commuter pass subsidy',
    },
    fieldUnits: {
      units: 'units',
      households: 'households',
      twdPerHouseholdMonth: 'TWD per household per month',
      twdPerPassMonth: 'TWD per pass per month',
    },
    effects: {
      // TODO(user text): review the wording of the effect statements. Each tool has equal numbers of
      // benefit and cost statements (Requirement 8.12). Lag values are shown next to each tool.
      socialHousing: {
        benefits: [
          'Renters in the district where units are completed: rent burden can fall, after the lag shown for this tool.',
          'Households that move into new units: housing cost can fall, after the lag shown for this tool.',
        ],
        costs: [
          'City budget: each unit started draws on the annual budget when it is committed, before any effect arrives.',
          'Other tools: money used here is not available for rent subsidy or commuter pass subsidy in the same year.',
        ],
      },
      rentSubsidy: {
        benefits: [
          'Subsidised renter households: rent burden can fall, after the lag shown for this tool.',
        ],
        costs: [
          'Renters who are not subsidised: part of the subsidy can be passed into higher rents, after the lag shown for this tool.',
        ],
      },
      commuterPass: {
        benefits: [
          'Commuters who hold a monthly pass: commuting cost can fall, after the lag shown for this tool.',
        ],
        costs: [
          'City budget: spending rises with the number of passes sold, which can use up the annual budget earlier.',
        ],
      },
    },
  },

  construction: {
    heading: 'Social housing under construction',
    district: 'District',
    committedQuarter: 'Committed',
    effectQuarter: 'Effect from',
    progress: '{n} of {lag} quarters',
    more: '{u} more units than real',
    fewer: '{u} fewer units than real',
    completesAfter: 'completes after 2025Q4',
    none: 'No social housing construction differs from the real track.',
  },

  timeline: {
    heading: 'Timeline',
    empty: 'No events or policy changes yet.',
    quarterHeading: '{quarter}',
    majorEvent: 'Major event',
    completion: 'Construction completed: {district}, {units} units',
    entry: '{tool}, {field}, {area}: {before} to {after}',
    realTrack: 'real track ({value})',
    dismissCards: 'Dismiss',
    sourceLink: 'Source',
    wikipediaAttribution: 'Text from Wikipedia, licensed CC BY-SA.',
  },

  dialogs: {
    close: 'Close',
    cancel: 'Cancel',
    confirm: 'Confirm',
    copy: 'Copy',
    confirmNewGameTitle: 'Start a new game?',
    confirmNewGame: 'The saved game in this browser will be replaced.',
    confirmLoadDemoTitle: 'Load the demo?',
    confirmLoadDemo: 'The saved game in this browser will be replaced.',
    confirmImportTitle: 'Import a save code?',
    confirmImport: 'The current game will be replaced.',
    exportTitle: 'Save code',
    storedTextTitle: 'Stored text',
    importTitle: 'Import a save code',
    importLabel: 'Paste a save code',
    rangeSourceTitle: 'Why this range?',
    eventCardTitle: 'Event',
  },

  rangeSource: {
    lowest: 'Lowest result',
    highest: 'Highest result',
    sameEverywhere: 'This value is the same under every parameter assumption in the model.',
    noSource: 'No source recorded',
    noUrl: 'No source recorded',
    parameterValue: '{name}: {value} {unit}',
    causeBreakdown: 'Cause breakdown (coming soon)',
    parameterNames: {
      'socialHousing.rentPerUnit': 'Rent change per social housing unit',
      'socialHousing.rentRatio': 'Social housing rent as a share of market rent',
      'commuterPass.elasticity': 'Commuter pass demand elasticity',
      'rentSubsidy.passThrough': 'Share of rent subsidy passed into rents',
      'ghost.commuteThreshold': 'Commute time threshold for a ghost',
      'ghost.shareCommuteWithin': 'Share of residents working within the district',
      'migration.commuteCostPerMinute': 'Migration response per minute of commute',
    },
  },

  startMenu: {
    title: 'Butterfly City',
    continue: 'Continue',
    newGame: 'New game',
    loadDemo: 'Load demo',
    storedProblem: 'The stored game could not be loaded: {reason}',
    exportStored: 'Export stored text',
  },

  storage: {
    notStored: 'This browser did not store the game. Export a save code to keep it.',
    copyFailed: 'The code could not be copied automatically. The text is selected; copy it by hand.',
    copied: 'Copied.',
  },

  importMessages: {
    errorAt: 'Import error at {path}: {reason}',
    differentVersion: 'This save code was made by a different version of Butterfly City.',
    engineVersionNotice:
      'This save was made with engine version {saved}. This app uses engine version {current}. Results may differ.',
    recomputeError: 'Import error: quarter {quarter} could not be computed: {reason}',
    imported: 'Save imported. Displayed quarter: {quarter}.',
  },

  demo: {
    notGenerated: 'The demo save has not been generated yet.',
    descriptionHeading: 'Demo game',
    examplesNote: 'These adjustments are examples, not recommendations.',
    adjustment: '{quarter}: {tool}, {field}, {area}: {value}',
    realTrack: 'real track',
    ghostLine: 'Ghost difference in 2021Q1 after one Next quarter: {value}',
    rentBurdenLine: 'Rent burden difference in {district} in 2021Q1 after one Next quarter: {value} percentage points',
    loadError: 'The demo could not be loaded: {reason}',
  },

  announcements: {
    quarterComputed: 'Quarter {quarter} computed.',
    majorEvents: 'Major events: {titles}.',
  },

  errors: {
    engine: 'Error {code}: {text}',
    // TODO(user text): wording of the timeline-cap message (shown when the timeline cannot take more entries).
    timelineCap: 'TODO(user text): timeline limit message.',
  },

  // 3D City_View (city-3d spec, added by Claude Code 2026-11-23).
  city: {
    canvasLabel: '3D city of the 41 districts. Use [ and ] to move between districts and Enter to select. Every district is also in the district list.',
    fallback: 'This browser cannot show the 3D city. Use the district list to select a district.',
    illustrationNote:
      'Buildings, streets, vehicles and people are illustrative. Their number follows population and their height follows the sale price per m². Landmarks are simplified models.',
    walk: 'Walk the streets',
    overview: 'Back to overview',
    pause: 'Pause city motion',
    resume: 'Resume city motion',
    qualityHigh: 'Quality: high',
    qualityLow: 'Quality: low',
    toolsLabel: 'City view',
    figuresNote:
      'Ghosts and butterflies show the change from real history: each ghost above a district is about 10 more people above a rent or commute line, each butterfly about 10 fewer.',
    metro: {
      prompt: '{station} station. Press E or',
      button: 'Take the metro',
      title: 'Metro from {station}: choose a station',
      here: '{station} (you are here)',
    },
    talk: {
      prompt: '{name} is here. Press E or',
      button: 'Talk',
    },
  },

  // Overlay layout of the Game_Screen (city-3d Requirement 9).
  layout: {
    policy: 'Policies',
    district: 'District',
    map: 'Map',
    timeline: 'Timeline',
    hide: 'Hide',
    show: 'Show',
    tabsLabel: 'Panels',
  },

  // Citizen stories (story-layer spec). Story text itself comes from citizens.json.
  story: {
    noValue: 'no value',
    title: 'Citizen',
    pickerHeading: 'Follow one household through the years. Each quarter shows what your policies mean for them.',
    change: 'Follow another household',
    quarter: 'Quarter {quarter}',
    noQuarter: 'The story starts when the first quarter is computed.',
    endingHeading: 'From 2015 to 2025',
    loadError: 'The citizen stories could not be loaded: {error}',
  },
} as const;
