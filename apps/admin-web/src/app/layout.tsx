import './globals.css'
import './admin-reference.css'
import '@block9/design-tokens/tokens.css'
import type { ReactNode } from 'react'
import { AuthProvider } from './auth-provider'
import { I18nProvider, getAppConfig } from '@block9/app-platform'
import { AppMessagesProvider, PwaControls } from '@block9/ui'
import { AdminFormFeedback } from '../lib/admin-form-feedback'

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
          <AuthProvider><AppMessagesProvider><AdminFormFeedback /><PwaControls appName={config.application.productName} />{children}</AppMessagesProvider></AuthProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
