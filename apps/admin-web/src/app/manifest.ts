import type { MetadataRoute } from 'next'
import { getAppConfig, getBrand } from '@nivasa/app-platform'

export default function manifest(): MetadataRoute.Manifest {
  const config = getAppConfig()
  const brand = getBrand()

  return {
    name: `${config.application.productName} | ${config.application.adminName}`,
    short_name: config.application.productName,
    description: config.application.description,
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#f6f7f8',
    theme_color: brand.theme.primaryColor,
    icons: [
      { src: brand.assets.logo, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: brand.assets.logo, sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  }
}
