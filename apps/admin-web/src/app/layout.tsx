import './globals.css'
import type { ReactNode } from 'react'
import { AuthProvider } from './auth-provider'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nivasa | Tenant administration', description: 'Tenant-aware apartment administration', manifest: '/manifest.webmanifest' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><AuthProvider>{children}</AuthProvider></body></html>
}
