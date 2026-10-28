import './globals.css'
import { residentAuthProvider } from '../lib/resident-auth-config'
import type { ReactNode } from 'react'
import { AuthProvider } from './auth-provider'
import { I18nProvider, getAppConfig } from '@block9/app-platform'
import { AppMessagesProvider, PwaControls } from '@block9/ui'

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
          <AuthProvider provider={residentAuthProvider()}>
            <AppMessagesProvider>
              <PwaControls appName={config.application.productName} />
              {children}
            </AppMessagesProvider>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
