/**
 * One-time helper: obtain a Google Drive OAuth REFRESH TOKEN so claim files can be
 * stored in a real Gmail account's Drive (service accounts can't store files on
 * personal accounts — Google quota rule).
 *
 * Prereq (Google Cloud console, project hr-and-payroll-502318):
 *   1. APIs & Services → OAuth consent screen → External → add your Gmail as a Test user.
 *   2. Credentials → Create credentials → OAuth client ID → type "Desktop app".
 *   3. Put the client id/secret in backend/.env as GOOGLE_OAUTH_CLIENT_ID / _SECRET.
 *
 * Run:  npx tsx scripts/get-drive-token.ts
 * Then: open the printed URL, log in with the Drive-owner Gmail, approve.
 * The refresh token is printed — paste it into .env as GOOGLE_OAUTH_REFRESH_TOKEN
 * (and remove GOOGLE_SERVICE_ACCOUNT_FILE so OAuth mode is used).
 */
import 'dotenv/config';
import http from 'http';
import { google } from 'googleapis';

const PORT = 53682;
const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in backend/.env first (Desktop-app OAuth client).');
  process.exit(1);
}

const redirectUri = `http://127.0.0.1:${PORT}`;
const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // force a refresh token even on re-consent
  // Full drive scope: the app must create files inside the pre-existing
  // "HR and Payroll" folder, which the narrower drive.file scope cannot see.
  scope: ['https://www.googleapis.com/auth/drive'],
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', redirectUri);
  const code = url.searchParams.get('code');
  if (!code) {
    res.end('Waiting for Google sign-in…');
    return;
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    res.end('✅ Done! Refresh token captured — you can close this tab and return to the terminal.');
    console.log('\n──────────────────────────────────────────────');
    console.log('GOOGLE_OAUTH_REFRESH_TOKEN=' + tokens.refresh_token);
    console.log('──────────────────────────────────────────────');
    console.log('Paste the line above into backend/.env, comment out GOOGLE_SERVICE_ACCOUNT_FILE,');
    console.log('then verify with: npx tsx scripts/verify-drive.ts --keep');
  } catch (e) {
    res.end('Token exchange failed — see terminal.');
    console.error('Exchange failed:', (e as Error).message);
  } finally {
    server.close();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n1) Open this URL in your browser (log in as the Gmail that should OWN the claim files):\n');
  console.log(authUrl);
  console.log('\n2) Approve access — the token will appear here automatically.\n');
});
