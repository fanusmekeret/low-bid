/**
 * Money is always an integer number of santim (1 ETB = 100 santim), held as bigint.
 * The API sends both a display string ("1250.00") and the *_minor integer as a string.
 */
export function toMinor(input: string | number | bigint): bigint {
  if (typeof input === "bigint") return input;
  if (typeof input === "number") {
    if (!Number.isSafeInteger(input)) throw new Error("amount_minor must be a safe integer");
    return BigInt(input);
  }
  if (!/^\d+$/.test(input)) throw new Error("amount_minor must contain digits only");
  return BigInt(input);
}

export function formatMinor(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const birr = abs / 100n;
  const santim = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${birr}.${santim}`;
}

/** Percentage of an amount in basis points, rounded half up. 1000 bps = 10%. */
export function percentBps(minor: bigint, bps: number): bigint {
  return (minor * BigInt(bps) + 5000n) / 10000n;
}

export function money(minor: bigint | null | undefined) {
  if (minor === null || minor === undefined) return null;
  return { amount: formatMinor(minor), amount_minor: minor.toString(), currency: "ETB" };
}
