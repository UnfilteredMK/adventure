/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: '.next',
  // Prevent OpenTelemetry from being bundled into vendor-chunks (avoids "Cannot find module './vendor-chunks/@opentelemetry.js'")
  // Next.js 14 uses experimental.serverComponentsExternalPackages; serverExternalPackages is Next 15+
  transpilePackages: ["@adventure/ai-form-ui-contract", "@adventure/refinement-server"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    // Exclude OpenTelemetry from client bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }

    // Silence noisy webpack warnings from OpenTelemetry's `require-in-the-middle`.
    // These are expected (dynamic require) and do not affect runtime in our usage.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      (warning) => {
        const message = typeof warning?.message === "string" ? warning.message : "";
        const resource =
          typeof warning?.module?.resource === "string"
            ? warning.module.resource
            : typeof warning?.module?.userRequest === "string"
              ? warning.module.userRequest
              : "";
        return (
          message.includes("Critical dependency: require function is used") &&
          resource.includes("require-in-the-middle")
        );
      },
    ];

    return config;
  },
  async redirects() {
    return [
      {
        source: '/ai-form/:instanceId',
        destination: '/form/:instanceId',
        permanent: false,
      },
    ]
  },
  // Force dynamic rendering for all pages
  experimental: {
    // Disable static optimization for API routes
    // Externalize OpenTelemetry so Node requires it natively (avoids vendor-chunk issues)
    serverComponentsExternalPackages: [
      '@opentelemetry/api',
      '@opentelemetry/core',
      '@opentelemetry/sdk-node',
      '@opentelemetry/resources',
      '@opentelemetry/semantic-conventions',
      '@opentelemetry/instrumentation',
      '@opentelemetry/instrumentation-http',
      '@opentelemetry/instrumentation-fetch',
      '@opentelemetry/exporter-trace-otlp-http',
      '@opentelemetry/exporter-metrics-otlp-http',
      '@opentelemetry/sdk-metrics',
    ],
  },
  // Ensure API routes are never cached
  async headers() {
    return [
      {
        source: '/api/widget/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },
          {
            key: 'Surrogate-Control',
            value: 'no-store',
          },
        ],
      },
      {
        source: '/api/instance/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },
          {
            key: 'Surrogate-Control',
            value: 'no-store',
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'replicate.delivery',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'pbxt.replicate.delivery',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.replicate.delivery',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'oaidalleapiprodscus.blob.core.windows.net',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/**',
      },
      // Shopify product images
      {
        protocol: 'https',
        hostname: '*.myshopify.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'cdn.shopify.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'shopify-cdn.shopify.com',
        port: '',
        pathname: '/**',
      },
    ],
  },
}

module.exports = nextConfig 
