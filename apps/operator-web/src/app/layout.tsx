import './globals.css'
import type { ReactNode } from 'react'
import { OperatorAuthProvider } from './auth-provider'
import { getAppConfig } from '@nivasa/app-platform'

const config = getAppConfig()

export const dynamic = 'force-dynamic'
export const metadata = { title: `${config.application.productName} | Platform operations`, description: 'Private platform operator console' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><OperatorAuthProvider>{children}</OperatorAuthProvider></body></html>
}
