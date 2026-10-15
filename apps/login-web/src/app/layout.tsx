import './globals.css'
import type { ReactNode } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nivasa | Sign in', description: 'Choose a secure Resident or Apartment Admin sign in' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>
}
