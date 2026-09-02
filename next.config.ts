import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: {
    buildActivity: false,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '6mb',
    },
  },
}

export default nextConfig
