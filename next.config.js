/** @type {import('next').NextConfig} */
const os = require('os')

// Collect all non-loopback IPv4 addresses on the dev machine at startup.
// These are the IPs a mobile device on the same LAN will see as the page
// origin, so they must be in allowedDevOrigins for Next.js to permit the
// cross-origin /_next/* requests that the HMR client makes.
// os.networkInterfaces() is Node core — no install required.
function getLanIPs() {
  const ips = []
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const detail of iface ?? []) {
      if (detail.family === 'IPv4' && !detail.internal) {
        ips.push(detail.address)
      }
    }
  }
  return ips
}

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
  },
  serverExternalPackages: ['exceljs'],

  // Dev-only: allow mobile/tablet devices on the same LAN to load
  // /_next/* resources without triggering the cross-origin block.
  // allowedDevOrigins is ignored by `next build` / `next start`.
  allowedDevOrigins: getLanIPs(),
}

module.exports = nextConfig
