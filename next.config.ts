import type { NextConfig } from 'next';
import withBundleAnalyzer from '@next/bundle-analyzer';
import { version } from './package.json';

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {},
  env: {
    // Map the server-only APP_USER_NAME logic to be accessible client-side
    NEXT_PUBLIC_APP_USER_NAME: process.env.APP_USER_NAME,
    // Expose app version for cache-busting React Query persistence
    NEXT_PUBLIC_APP_VERSION: version,
  },
  // Note: Removed ignoreBuildErrors - TypeScript errors should be fixed, not ignored
  // typescript: { ignoreBuildErrors: true },
};

export default process.env.ANALYZE === 'true'
  ? withBundleAnalyzer({
      enabled: true,
    })(nextConfig)
  : nextConfig;
