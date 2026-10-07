import { describe, expect, it } from 'vitest';
import { parseUsdcAmount, validateWalletAddress } from './pusd-onramp';

describe('pUSD onramp input validation', () => {
  it('parses six-decimal USDC.e amounts exactly', () => {
    expect(parseUsdcAmount('12.340001', 20_000_000n)).toBe(12_340_001n);
  });

  it('rejects zero, malformed, excess-precision, and over-balance amounts', () => {
    expect(() => parseUsdcAmount('0', 20_000_000n)).toThrow(/greater than zero/);
    expect(() => parseUsdcAmount('-1', 20_000_000n)).toThrow(/positive amount/);
    expect(() => parseUsdcAmount('1.0000001', 20_000_000n)).toThrow(/6 decimal places/);
    expect(() => parseUsdcAmount('21', 20_000_000n)).toThrow(/exceeds/);
  });

  it('normalizes valid recipient addresses and rejects invalid ones', () => {
    expect(validateWalletAddress('0x0000000000000000000000000000000000000001'))
      .toBe('0x0000000000000000000000000000000000000001');
    expect(() => validateWalletAddress('not-an-address')).toThrow(/valid Polygon wallet address/);
  });
});