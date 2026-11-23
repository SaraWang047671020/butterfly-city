// Placeholder registry (story-layer Requirement 3.4): every Placeholder name of citizens.json and model-limits.json
// with the producer of its value.

export type Producer = 'storyFacts' | 'modelFacts';

export const PLACEHOLDER_REGISTRY: Readonly<Record<string, Producer>> = {
  name: 'storyFacts',
  homeDistrict: 'storyFacts',
  workDistrict: 'storyFacts',
  rentBurden: 'storyFacts',
  rentRiskThreshold: 'storyFacts',
  rentGhostThreshold: 'storyFacts',
  commuteMinutes: 'storyFacts',
  commuteRiskThreshold: 'storyFacts',
  commuteGhostThreshold: 'storyFacts',
  commuteHoursMonth: 'storyFacts',
  rentBurdenReal: 'storyFacts',
  rentBurdenDiff: 'storyFacts',
  rentBurdenLow: 'storyFacts',
  rentBurdenHigh: 'storyFacts',
  ghostSize: 'storyFacts',
  realQuarter: 'storyFacts',
  quartersAtRisk: 'storyFacts',
  quartersAtRiskReal: 'storyFacts',
  commuteAvg: 'storyFacts',
  commuteAvgReal: 'storyFacts',
  quartersGhost: 'storyFacts',
  quartersGhostReal: 'storyFacts',
  commuteModelled: 'modelFacts',
  commuteSurvey: 'modelFacts',
  backtestResult: 'modelFacts',
};
