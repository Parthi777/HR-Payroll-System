/**
 * Google ID tokens — the verified email inside one, checked by the server.
 *
 * Used by the public sign-up page only: the address a dealership signs up with
 * is taken from Google instead of typed, so it is known to be theirs. Nothing
 * signs in with Google — not the console, Master Control or the app.
 */
import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

type Verifier = (credential: string) => Promise<{ email?: string; emailVerified?: boolean }>;

/** Set by tests, which cannot mint a token Google would sign. */
let override: Verifier | null = null;
export function setGoogleVerifierForTests(v: Verifier | null): void {
  override = v;
}

export function googleSignInConfigured(): boolean {
  return Boolean(override || env.GOOGLE_WEB_CLIENT_ID);
}

let client: OAuth2Client | null = null;

/** The verified email inside a Google ID token, or a 401. */
export async function verifiedGoogleEmail(credential: string): Promise<string> {
  let claims: { email?: string; emailVerified?: boolean };
  try {
    if (override) {
      claims = await override(credential);
    } else {
      client ??= new OAuth2Client(env.GOOGLE_WEB_CLIENT_ID);
      // Checks Google's signature, expiry, issuer and that the token was minted
      // for our client id — a token issued to another site is refused.
      const payload = (await client.verifyIdToken({ idToken: credential, audience: env.GOOGLE_WEB_CLIENT_ID })).getPayload();
      claims = { email: payload?.email, emailVerified: payload?.email_verified };
    }
  } catch {
    throw AppError.unauthorized('Google sign-in failed — try again');
  }
  if (!claims.email || !claims.emailVerified) throw AppError.unauthorized('That Google account has no verified email');
  return claims.email.trim().toLowerCase();
}
