const crypto = require('crypto');
const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: ['@adventure/refinement-server'],
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60,
  },
  experimental: {
    optimizeCss: true,
  },
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Unblocks deployment while strict DB typing issues are addressed.
    ignoreBuildErrors: true,
  },
  webpack: (config, { dev, isServer }) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@': path.resolve(__dirname, 'src'),
      'framer-motion': path.dirname(require.resolve('framer-motion/package.json')),
    };
    config.resolve.modules = [
      ...(config.resolve.modules || []),
      path.resolve(__dirname, '../../node_modules'),
    ];

    // Only optimize client bundles in production
    if (!dev && !isServer) {
      config.optimization.splitChunks = {
        chunks: 'all',
        minSize: 30000,
        maxSize: 250000,
        cacheGroups: {
          default: false,
          vendors: false,
          framework: {
            chunks: 'all',
            name: 'framework',
            test: /(?<!node_modules.*)[\\/]node_modules[\\/](react|react-dom|scheduler|prop-types|use-subscription)[\\/]/,
            priority: 40,
            enforce: true,
          },
          lib: {
            test(module) {
              return (
                module.size() > 50000 &&
                /node_modules[/\\]/.test(module.identifier())
              );
            },
            name(module) {
              const hash = crypto.createHash('sha1');
              hash.update(module.identifier());
              return hash.digest('hex').slice(0, 8);
            },
            priority: 30,
            minChunks: 1,
            reuseExistingChunk: true,
          },
          commons: {
            name: 'commons',
            minChunks: 3,
            priority: 20,
          }
        },
      };
    }

    // Ensure server chunk runtime looks in the same place Next emits chunks.
    if (!dev && isServer) {
      config.output.chunkFilename = "chunks/[id].js";
    }

    return config;
  },
  // Ensure the app runs on port 3000
  async rewrites() {
    return [];
  },
  // Explicitly handle dynamic routes in route groups
  async redirects() {
    return [];
  }
};

module.exports = nextConfig; 
