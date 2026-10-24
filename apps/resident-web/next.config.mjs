/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true, experimental: { middlewareClientMaxBodySize: '22mb' }, typedRoutes: true, transpilePackages: ['@block9/api-client', '@block9/auth-types', '@block9/ui'] }
export default nextConfig
