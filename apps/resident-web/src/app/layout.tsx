import './globals.css'
import '@block9/design-tokens/tokens.css'
import { ResidentQrBanner } from '../lib/resident-qr-banner'
import { residentAuthProvider } from '../lib/resident-auth-config'
import type { ReactNode } from 'react'
import { AuthProvider } from './auth-provider'
import { ResidentQueryProvider } from './query-provider'
import { I18nProvider, getAppConfig } from '@block9/app-platform'
import { AppMessagesProvider } from '@block9/ui'
import { AuthenticatedPwaControls } from '../lib/authenticated-pwa-controls'

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
          <ResidentQueryProvider>
            <AuthProvider provider={residentAuthProvider()}>
              <AppMessagesProvider>
                <AuthenticatedPwaControls appName={config.application.productName} />
                <ResidentQrBanner />
                {children}
              </AppMessagesProvider>
            </AuthProvider>
          </ResidentQueryProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
