import { describe, expect, it } from "vitest";
import { INDICATOR_SPECS, POLICY_SERIES_SPECS } from "../../../scripts/pipeline/registry/indicators.ts";
import { METHOD_REGISTRY, methodById, referencedMethods } from "../../../scripts/pipeline/registry/methods.ts";
import {
  SOURCE_REGISTRY,
  redactUrl,
  referencedSources,
  sourceById,
} from "../../../scripts/pipeline/registry/sources.ts";

describe("source registry", () => {
  it("has unique ids and absolute http(s) URLs without credential values", () => {
    const ids = SOURCE_REGISTRY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(30);
    for (const s of SOURCE_REGISTRY) {
      expect(s.url).toMatch(/^https?:\/\/\S+$/);
      expect(s.url).not.toMatch(/api_?key=(?!REDACTED)/i);
      expect(redactUrl(s.url)).toBe(s.url);
      expect(s.years[0]).toBeLessThanOrEqual(s.years[1]);
      expect(s.license.length).toBeGreaterThan(0);
    }
  });

  it("has no air-quality sources", () => {
    expect(SOURCE_REGISTRY.some((s) => /pm25|air/i.test(s.id))).toBe(false);
  });

  it("looks up by id and throws on unknown ids", () => {
    expect(sourceById("income/fia-103066").years).toEqual([2014, 2023]);
    expect(() => sourceById("nope/x")).toThrow(/nope\/x/);
    expect(() => referencedSources(["nope/x"])).toThrow();
  });

  it("returns referenced sources in registry order without duplicates", () => {
    const got = referencedSources(["policy/mof-6742", "boundaries/moi-7441", "policy/mof-6742"]);
    expect(got.map((s) => s.id)).toEqual(["boundaries/moi-7441", "policy/mof-6742"]);
  });
});

describe("redactUrl", () => {
  it("replaces credential parameter values and keeps the rest", () => {
    expect(redactUrl("https://a.example/x?format=json&api_key=SECRET&page=2")).toBe(
      "https://a.example/x?format=json&api_key=REDACTED&page=2",
    );
    expect(redactUrl("https://a.example/x?apikey=1&Token=2&client_secret=3#frag")).toBe(
      "https://a.example/x?apikey=REDACTED&Token=REDACTED&client_secret=REDACTED#frag",
    );
  });

  it("is idempotent and leaves other URLs unchanged", () => {
    const once = redactUrl("https://a.example/?key=abc&keyword=k");
    expect(once).toBe("https://a.example/?key=REDACTED&keyword=k");
    expect(redactUrl(once)).toBe(once);
    expect(redactUrl("https://a.example/path")).toBe("https://a.example/path");
  });
});

describe("indicator lists", () => {
  it("lists 12 district then 2 city indicators in the fixed order", () => {
    expect(INDICATOR_SPECS.map((i) => i.id)).toEqual([
      "population",
      "moveIn",
      "moveOut",
      "relativeMedianIncome",
      "householdIncome",
      "salePrice",
      "rent",
      "mrtEntries",
      "socialHousingCompletions",
      "socialHousingStock",
      "lowUseHousingCount",
      "lowUseHousingRate",
      "cityDisposableIncome",
      "priceToIncomeRatio",
    ]);
    expect(INDICATOR_SPECS.filter((i) => i.level === "district")).toHaveLength(12);
    expect(INDICATOR_SPECS.slice(12).every((i) => i.level === "city")).toBe(true);
  });

  it("lists 10 policy series in the fixed order, only the first at district level", () => {
    expect(POLICY_SERIES_SPECS.map((p) => p.id)).toEqual([
      "socialHousingUnitsStarted",
      "subleaseUnitsMatched",
      "rentSubsidyHouseholds",
      "rentSubsidyAmountPerHousehold",
      "holdingTaxRateLowestTier",
      "holdingTaxRateHighestTier",
      "houseTaxRevenue",
      "commuterPassPrice",
      "commuterPassSubsidy",
      "commuterPassesSold",
    ]);
    expect(POLICY_SERIES_SPECS.filter((p) => p.level === "district")).toHaveLength(1);
  });

  it("has unique ids, valid fields and registered sources", () => {
    const all = [...INDICATOR_SPECS, ...POLICY_SERIES_SPECS];
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const s of all) {
      expect(s.sources.length).toBeGreaterThan(0);
      for (const id of s.sources) expect(() => sourceById(id), `${s.id} -> ${id}`).not.toThrow();
      expect(s.description.length).toBeGreaterThanOrEqual(1);
      expect(s.description.length).toBeLessThanOrEqual(200);
      expect(Number.isInteger(s.decimals) && s.decimals >= 0 && s.decimals <= 6).toBe(true);
    }
  });
});

describe("method registry", () => {
  it("has unique kebab-case ids and registered inputs", () => {
    const ids = METHOD_REGISTRY.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of METHOD_REGISTRY) {
      expect(m.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(m.setsEstimated).toBe(true);
      for (const s of m.inputs) expect(() => sourceById(s), `${m.id} -> ${s}`).not.toThrow();
    }
    for (const id of ["district-area", "district-centroid", "boundary-simplify", "interp-annual-quarterly"]) {
      expect(ids).toContain(id);
    }
  });

  it("applies only to known indicators, policy series or district fields", () => {
    const known = new Set<string>([
      ...INDICATOR_SPECS.map((i) => i.id),
      ...POLICY_SERIES_SPECS.map((p) => p.id),
      "areaKm2",
      "centroid",
      "geometry",
    ]);
    for (const m of METHOD_REGISTRY) for (const a of m.appliesTo) expect(known.has(a), `${m.id} -> ${a}`).toBe(true);
  });

  it("returns referenced methods in registry order and throws on unknown ids", () => {
    const got = referencedMethods(["district-area", "interp-annual-quarterly", "district-area"]);
    expect(got.map((m) => m.id)).toEqual(["interp-annual-quarterly", "district-area"]);
    expect(methodById("district-area").id).toBe("district-area");
    expect(() => methodById("nope")).toThrow();
    expect(() => referencedMethods(["nope"])).toThrow();
  });
});
