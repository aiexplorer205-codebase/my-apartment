import './globals.css'
import type { ReactNode } from 'react'
import { AuthProvider } from './auth-provider'
import { PwaRegistration } from './pwa-registration'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nivasa | Resident workspace', description: 'Apartment services for residents', manifest: '/manifest.webmanifest' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><AuthProvider><PwaRegistration />{children}</AuthProvider></body></html>
}
