import './globals.css'
import type { ReactNode } from 'react'
import { OperatorAuthProvider } from './auth-provider'
import { getAppConfig } from '@nivasa/app-platform'
import { AppMessagesProvider } from '@nivasa/ui'

const config = getAppConfig()

export const dynamic = 'force-dynamic'
export const metadata = { title: `${config.application.productName} | Platform operations`, description: 'Private platform operator console' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body><OperatorAuthProvider><AppMessagesProvider>{children}</AppMessagesProvider></OperatorAuthProvider></body></html>
}
