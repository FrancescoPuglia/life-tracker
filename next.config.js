/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export ONLY for GitHub Pages (GH Actions sets GITHUB_PAGES=true).
  // Vercel also sets CI=true, so CI alone is NOT a safe trigger for static export.
  ...(process.env.GITHUB_PAGES && {
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
