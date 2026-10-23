import './globals.css'
import type { ReactNode } from 'react'
import { AuthProvider } from './auth-provider'
import { I18nProvider, getAppConfig } from '@nivasa/app-platform'
import { AppMessagesProvider, PwaControls } from '@nivasa/ui'

const config = getAppConfig()

export const dynamic = 'force-dynamic'
export const metadata = {
  title: `${config.application.productName} | ${config.application.adminName}`,
  description: config.application.description,
  manifest: '/manifest.webmanifest',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <I18nProvider namespaces={['common', 'admin', 'validation']}>
          <AuthProvider><AppMessagesProvider><PwaControls appName={config.application.productName} />{children}</AppMessagesProvider></AuthProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
