import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nivasa Tenant Admin',
    short_name: 'Nivasa Admin',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#f6f7f8',
    theme_color: '#174c43',
    icons: [
      { src: '/icons/nivasa.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/nivasa.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  }
}
