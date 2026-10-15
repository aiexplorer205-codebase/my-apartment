import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nivasa Resident',
    short_name: 'Nivasa',
    description: 'Resident services and apartment updates',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f7f8',
    theme_color: '#174c43',
    icons: [
      { src: '/icons/nivasa.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/nivasa.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  }
}
