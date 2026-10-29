/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  typedRoutes: true,
  transpilePackages: ['@block9/app-platform'],
};

export default nextConfig;
