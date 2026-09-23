import type { NextConfig } from 'next';
import withBundleAnalyzer from '@next/bundle-analyzer';
import { version } from './package.json';

// When building for Capacitor Android (`npm run android:export`),
// OUTPUT=export switches to Next.js static export mode.
const isStaticExport = process.env.OUTPUT === 'export';

const nextConfig: NextConfig = {
  reactCompiler: true,
  turbopack: {},
  // Static export for Capacitor — only active when OUTPUT=export
  ...(isStaticExport && {
    output: 'export',
    // Static export requires unoptimized images (no server-side optimization)
    images: { unoptimized: true },
  }),
  env: {
    // Map the server-only APP_USER_NAME logic to be accessible client-side
    NEXT_PUBLIC_APP_USER_NAME: process.env.APP_USER_NAME,
    // Expose app version for cache-busting React Query persistence
    NEXT_PUBLIC_APP_VERSION: version,
    // Let client code know it's in static export / Capacitor mode
    NEXT_PUBLIC_IS_STATIC_EXPORT: isStaticExport ? 'true' : '',
  },
  // Note: Removed ignoreBuildErrors - TypeScript errors should be fixed, not ignored
  // typescript: { ignoreBuildErrors: true },
};

export default process.env.ANALYZE === 'true'
  ? withBundleAnalyzer({
      enabled: true,
    })(nextConfig)
  : nextConfig;
