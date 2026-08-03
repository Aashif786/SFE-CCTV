/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { dev }) => {
    if (dev) {
      // Disable persistent disk caching in dev to prevent missing chunk './948.js' & raw HTML style loss during HMR
      config.cache = false;
    }
    return config;
  },
};

module.exports = nextConfig;
