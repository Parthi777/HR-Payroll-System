/**
 * The one-time-password algorithm, against the published test vectors.
 *
 * Getting TOTP subtly wrong does not fail loudly — it produces six digits that
 * no authenticator app will ever agree with, and everyone is locked out of the
 * console at once. So this checks the arithmetic against RFC 6238 Appendix B
 * rather than against itself.
 */
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  codeForStep,
  generateSecret,
  matchStep,
  otpauthUri,
  stepAt,
} from '../src/services/platform/totp.js';

// RFC 6238's SHA-1 seed is the ASCII string "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('totp', () => {
  it('matches the RFC 6238 SHA-1 test vectors', () => {
    const vectors: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [seconds, expected] of vectors) {
      expect(codeForStep(RFC_SECRET, stepAt(seconds * 1000), 8), `T=${seconds}`).toBe(expected);
    }
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7, 99]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    // Authenticator apps print secrets in lowercase groups; both must read back.
    expect(base32Decode('gezd gnbv gy3t qojq').toString('ascii')).toBe('1234567890');
  });

  it('generates a 160-bit secret', () => {
    expect(base32Decode(generateSecret())).toHaveLength(20);
    expect(generateSecret()).not.toBe(generateSecret());
  });

  describe('matching a submitted code', () => {
    const secret = generateSecret();
    const now = 1_760_000_000_000;
    const step = stepAt(now);

    it('accepts the current step and one either side, and reports which', () => {
      expect(matchStep(secret, codeForStep(secret, step), now)).toBe(step);
      expect(matchStep(secret, codeForStep(secret, step - 1), now)).toBe(step - 1);
      expect(matchStep(secret, codeForStep(secret, step + 1), now)).toBe(step + 1);
    });

    it('refuses a code two steps out', () => {
      expect(matchStep(secret, codeForStep(secret, step - 2), now)).toBeNull();
      expect(matchStep(secret, codeForStep(secret, step + 2), now)).toBeNull();
    });

    it('refuses anything that is not six digits', () => {
      const code = codeForStep(secret, step);
      expect(matchStep(secret, `${code} `, now)).toBeNull();
      expect(matchStep(secret, code.slice(1), now)).toBeNull();
      expect(matchStep(secret, 'abcdef', now)).toBeNull();
    });
  });

  it('builds a URI an authenticator app can read', () => {
    const uri = new URL(otpauthUri('JBSWY3DPEHPK3PXP', 'owner@example.com', 'HR Payroll Platform'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/HR Payroll Platform:owner@example.com');
    expect(uri.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(uri.searchParams.get('issuer')).toBe('HR Payroll Platform');
  });
});
