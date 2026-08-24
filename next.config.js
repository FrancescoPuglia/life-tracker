/** @type {import('next').NextConfig} */
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
};

module.exports = nextConfig;
