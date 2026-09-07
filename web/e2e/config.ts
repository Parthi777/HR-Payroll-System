/** Ports and URLs for the e2e stack — deliberately not the dev ones, so a
 *  running dev server is never disturbed and never accidentally under test. */
export const API_PORT = 3399;
export const WEB_PORT = 3400;

export const API_URL = `http://127.0.0.1:${API_PORT}/api`;
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:55433/hre2e';
