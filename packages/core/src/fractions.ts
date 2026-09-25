export type Fraction = { n: number; d: number };
const gcd = (a: bigint, b: bigint): bigint =>
  b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b);
function make(n: bigint, d: bigint): Fraction {
  if (d <= 0n) throw new Error("Fraction denominator must be positive");
  const g = gcd(n, d);
  const nn = n / g;
  const dd = d / g;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (nn > max || nn < -max || dd > max)
    throw new Error("Fraction exceeds safe integer limit");
  return { n: Number(nn), d: Number(dd) };
}
export const frac = (n: number | bigint, d: number | bigint = 1) => {
  if (
    (typeof n === "number" && !Number.isSafeInteger(n)) ||
    (typeof d === "number" && !Number.isSafeInteger(d))
  )
    throw new Error("Unsafe fraction");
  return make(BigInt(n), BigInt(d));
};
export const zero = () => frac(0);
export const add = (a: Fraction, b: Fraction) =>
  make(
    BigInt(a.n) * BigInt(b.d) + BigInt(b.n) * BigInt(a.d),
    BigInt(a.d) * BigInt(b.d),
  );
export const sub = (a: Fraction, b: Fraction) => add(a, frac(-b.n, b.d));
export const mul = (a: Fraction, b: Fraction) =>
  make(BigInt(a.n) * BigInt(b.n), BigInt(a.d) * BigInt(b.d));
export const div = (a: Fraction, b: Fraction) =>
  make(BigInt(a.n) * BigInt(b.d), BigInt(a.d) * BigInt(b.n));
export const cmp = (a: Fraction, b: Fraction) => {
  const x = BigInt(a.n) * BigInt(b.d);
  const y = BigInt(b.n) * BigInt(a.d);
  return x < y ? -1 : x > y ? 1 : 0;
};
export const eq = (a: Fraction, b: Fraction) => cmp(a, b) === 0;
export const lt = (a: Fraction, b: Fraction) => cmp(a, b) < 0;
export const lte = (a: Fraction, b: Fraction) => cmp(a, b) <= 0;
export const gt = (a: Fraction, b: Fraction) => cmp(a, b) > 0;
export const value = (a: Fraction) => a.n / a.d;
export const max = (a: Fraction, b: Fraction) => (cmp(a, b) >= 0 ? a : b);
export const min = (a: Fraction, b: Fraction) => (cmp(a, b) <= 0 ? a : b);
export const lcm = (a: number, b: number) => {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a <= 0 || b <= 0)
    throw new Error("Invalid LCM input");
  const result = (BigInt(a) / gcd(BigInt(a), BigInt(b))) * BigInt(b);
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Fraction exceeds safe integer limit");
  return Number(result);
};
export const toKey = (a: Fraction) => `${a.n}/${a.d}`;
