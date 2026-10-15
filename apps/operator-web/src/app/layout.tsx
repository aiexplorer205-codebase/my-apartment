import './globals.css'
import type { ReactNode } from 'react'
import { OperatorAuthProvider } from './auth-provider'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Nivasa | Platform operations', description: 'Private platform operator console' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><OperatorAuthProvider>{children}</OperatorAuthProvider></body></html>
}
