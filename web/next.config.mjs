/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'res.cloudinary.com' }],
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL,
    // The apex tenants live under, e.g. "yourapp.com". Unset means subdomains
    // are not in use and the tenant comes from ?tenant= or the last sign-in.
    NEXT_PUBLIC_APP_BASE_DOMAIN: process.env.NEXT_PUBLIC_APP_BASE_DOMAIN,
  },
};

export default nextConfig;
