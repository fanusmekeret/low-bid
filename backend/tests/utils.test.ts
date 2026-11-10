import { describe, expect, it } from "vitest";
import { formatMinor, money, percentBps, toMinor } from "../src/utils/money.js";
import { bidderAlias } from "../src/utils/mask.js";
import { normalizePhone } from "../src/modules/auth/schemas.js";

describe("money", () => {
  it("formats santim as birr with two decimals", () => {
    expect(formatMinor(12_500_000n)).toBe("125000.00");
    expect(formatMinor(5n)).toBe("0.05");
    expect(formatMinor(-150n)).toBe("-1.50");
  });
  it("parses only integer santim", () => {
    expect(toMinor("12500")).toBe(12_500n);
    expect(() => toMinor("12.5")).toThrow();
    expect(() => toMinor(1.5)).toThrow();
  });
  it("computes basis-point percentages with half-up rounding", () => {
    expect(percentBps(12_500_000n, 1000)).toBe(1_250_000n); // 10%
    expect(percentBps(15n, 1000)).toBe(2n); // 1.5 -> 2
    expect(percentBps(14n, 1000)).toBe(1n);
  });
  it("serialises money as strings", () => {
    expect(money(12_345n)).toEqual({ amount: "123.45", amount_minor: "12345", currency: "ETB" });
    expect(money(null)).toBeNull();
  });
});

describe("bidderAlias", () => {
  it("masks names", () => {
    expect(bidderAlias("Abebe Kebede", 4n)).toBe("A***e 4");
    expect(bidderAlias("", 9n)).toBe("Bidder 9");
  });
});

describe("normalizePhone", () => {
  it("accepts common Ethiopian formats", () => {
    for (const v of ["0911223344", "+251911223344", "251911223344", "911223344", "0711 22 33 44"]) {
      expect(normalizePhone(v)).toMatch(/^\+251[79]\d{8}$/);
    }
  });
  it("rejects anything else", () => {
    expect(normalizePhone("0811223344")).toBeNull();
    expect(normalizePhone("+1 555 123 4567")).toBeNull();
  });
});
