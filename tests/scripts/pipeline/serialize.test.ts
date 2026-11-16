import { describe, expect, it } from "vitest";
import { formatNumber, serializeJson } from "../../../scripts/pipeline/serialize.ts";

describe("formatNumber", () => {
  it("rounds and prints without trailing zeros or exponent", () => {
    expect(formatNumber(1.23456789, 3)).toBe("1.235");
    expect(formatNumber(2, 6)).toBe("2");
    expect(formatNumber(0.0000004, 6)).toBe("0");
    expect(formatNumber(1234567890123, 0)).toBe("1234567890123");
  });

  it("never prints -0", () => {
    expect(formatNumber(-0, 2)).toBe("0");
    expect(formatNumber(-0.0001, 2)).toBe("0");
  });

  it("throws on non-finite values and exponent tokens", () => {
    expect(() => formatNumber(NaN, 2)).toThrow();
    expect(() => formatNumber(Infinity, 2)).toThrow();
    expect(() => formatNumber(-Infinity, 2)).toThrow();
    expect(() => formatNumber(1e21, 0)).toThrow();
  });
});

describe("serializeJson", () => {
  it("writes primitive-only containers on one line", () => {
    expect(serializeJson([121.52345, 25.03311])).toBe("[121.52345, 25.03311]\n");
    expect(serializeJson({ value: 1234, estimated: false })).toBe(
      '{ "value": 1234, "estimated": false }\n',
    );
    expect(serializeJson([])).toBe("[]\n");
    expect(serializeJson({})).toBe("{}\n");
  });

  it("indents nested containers by 2 spaces and keeps insertion order", () => {
    const text = serializeJson({ b: [{ x: 1 }, { x: 2 }], a: { c: [1, 2], d: null } });
    expect(text).toBe(
      [
        "{",
        '  "b": [',
        '    { "x": 1 },',
        '    { "x": 2 }',
        "  ],",
        '  "a": {',
        '    "c": [1, 2],',
        '    "d": null',
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("writes non-ASCII strings as UTF-8 and escapes quotes", () => {
    expect(serializeJson(["萬華", 'a"b'])).toBe('["萬華", "a\\"b"]\n');
  });

  it("uses LF only, one trailing LF, no BOM", () => {
    const text = serializeJson({ a: [{ b: 1 }] });
    expect(text).not.toContain("\r");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("normalises -0 and throws on NaN, Infinity and exponent tokens", () => {
    expect(serializeJson([-0])).toBe("[0]\n");
    expect(() => serializeJson([NaN])).toThrow();
    expect(() => serializeJson({ a: Infinity })).toThrow();
    expect(() => serializeJson([1e-7])).toThrow();
    expect(() => serializeJson([1e21])).toThrow();
  });

  it("throws on unsupported values", () => {
    expect(() => serializeJson({ a: undefined })).toThrow();
  });
});
