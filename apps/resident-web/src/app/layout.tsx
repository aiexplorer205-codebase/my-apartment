import './globals.css'
import type { ReactNode } from 'react'
import { AuthProvider } from './auth-provider'
import { PwaRegistration } from './pwa-registration'
import { I18nProvider, getAppConfig } from '@nivasa/app-platform'

const config = getAppConfig()

export const dynamic = 'force-dynamic'
export const metadata = {
  title: `${config.application.productName} | ${config.application.residentName}`,
  description: config.application.description,
  manifest: '/manifest.webmanifest',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <I18nProvider namespaces={['common', 'resident', 'validation']}>
          <AuthProvider>
            <PwaRegistration />
            {children}
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
