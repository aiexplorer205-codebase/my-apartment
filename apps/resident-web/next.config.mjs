/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true, experimental: { middlewareClientMaxBodySize: '22mb' }, typedRoutes: true, transpilePackages: ['@nivasa/api-client', '@nivasa/auth-types', '@nivasa/ui'] }
export default nextConfig
