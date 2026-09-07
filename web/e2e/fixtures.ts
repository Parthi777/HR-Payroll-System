/**
 * Test fixtures shared by every spec.
 *
 * The one thing worth explaining is the client IP. Sign-in is rate-limited to
 * five attempts per ten minutes per IP, and every request from this suite comes
 * from 127.0.0.1 — so without this the suite would trip a real security control
 * and report it as a product failure. The backend trusts X-Forwarded-For (it
 * runs behind a proxy in production), so giving each test its own address is
 * what a room full of real users looks like, and leaves the limiter armed.
 */
import { test as base, expect } from '@playwright/test';

let ip = 0;

export const test = base.extend<object, { workerIp: string }>({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, use) => {
    ip += 1;
    await use({
      ...extraHTTPHeaders,
      'X-Forwarded-For': `10.10.${Math.floor(ip / 250)}.${ip % 250}`,
    });
  },
});

export { expect };
