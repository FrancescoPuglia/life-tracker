/** @type {import('next').NextConfig} */
const path = require('node:path');

const isGitHubPages = process.env.GITHUB_PAGES === 'true';
const isTauriDesktop = process.env.TAURI_DESKTOP === 'true';
const isStaticExport = isGitHubPages || isTauriDesktop;
const tauriDevHost = process.env.TAURI_DEV_HOST || 'localhost';

const nextConfig = {
  ...(isStaticExport && {
    output: 'export',
    trailingSlash: true,
  }),
  ...(isGitHubPages && {
    basePath: '/life-tracker',
    assetPrefix: '/life-tracker/',
  }),
  ...(!isStaticExport && process.env.TAURI_DEV_HOST && {
    assetPrefix: `http://${tauriDevHost}:3000`,
  }),
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@life-tracker/ai-contract': path.resolve(
        __dirname,
        'packages/ai-contract/index.js',
      ),
    };
    return config;
  },
};

module.exports = nextConfig;
