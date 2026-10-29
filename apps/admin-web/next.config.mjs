/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    const development = process.env.NODE_ENV !== 'production'
    // Next hydration currently requires inline scripts; nonce-based CSP is a follow-up.
    // Direct private object uploads bypass this origin. Supply the HTTPS bucket
    // origin at build time in production; never use a wildcard provider domain.
    const storage = process.env.PHOTO_STORAGE_ORIGIN
    if (storage && (new URL(storage).origin !== storage || new URL(storage).protocol !== 'https:')) throw new Error('PHOTO_STORAGE_ORIGIN must be an HTTPS origin')
    const csp = [
      "default-src 'self'", "base-uri 'self'", "object-src 'none'",
      "frame-ancestors 'none'", "form-action 'self'",
      `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'", `img-src 'self' data: blob:${storage ? ` ${storage}` : ''}`,
      "font-src 'self' data:", `connect-src 'self'${storage ? ` ${storage}` : ''}${development ? ' ws: wss: http://localhost:59000 http://127.0.0.1:59000' : ''}`,
      "worker-src 'self'", "manifest-src 'self'",
    ].join('; ')
    return [{ source: '/:path*', headers: [
      { key: 'Content-Security-Policy', value: csp },
      ...(process.env.WEB_HSTS === 'true' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ] }, { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, max-age=0, must-revalidate' }] }]
  },
  output: 'standalone',
  typedRoutes: true,
  transpilePackages: ['@block9/app-platform'],
};

export default nextConfig;
