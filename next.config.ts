import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  eslint: {
    // La qualità è presidiata da `npm run typecheck` + `npm test`.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
