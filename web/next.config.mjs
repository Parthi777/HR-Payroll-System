import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Turbopack is the default bundler from Next 16, and it infers the project
  // root by walking up for a lockfile. There is a stray package-lock.json in
  // the home directory above this repository, so it inferred the wrong root and
  // `next dev` served a page that never hydrated — a blank screen with no error
  // in the console, while `next start` on the same code was fine. Stating the
  // root removes the guess, and removes the dependence on what happens to be
  // lying around in a parent directory.
  turbopack: { root: here },

  // No `images` config: `next/image` is not used anywhere in this app, and the
  // only remotePattern was res.cloudinary.com, left from a storage backend that
  // has since been replaced by S3 and Drive — nothing in either codebase
  // mentions Cloudinary and no CLOUDINARY_* variable is set in production. An
  // unused remote pattern is not free: it is what the image optimiser will
  // fetch and re-serve on request, which is the surface of the Next 15 image
  // DoS advisory.

  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL,
    // The apex tenants live under, e.g. "yourapp.com". Unset means subdomains
    // are not in use and the tenant comes from ?tenant= or the last sign-in.
    NEXT_PUBLIC_APP_BASE_DOMAIN: process.env.NEXT_PUBLIC_APP_BASE_DOMAIN,
  },
};

export default nextConfig;
