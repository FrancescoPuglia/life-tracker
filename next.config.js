/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable static export for GitHub Pages
  ...(process.env.CI && {
    output: 'export',
    trailingSlash: true,
    basePath: '/life-tracker',
    assetPrefix: '/life-tracker/',
  }),
  images: {
    unoptimized: true
  },
  typescript: {
    ignoreBuildErrors: false
  },
  eslint: {
    ignoreDuringBuilds: false
  }
}

module.exports = nextConfig