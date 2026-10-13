import './globals.css'
import type { ReactNode } from 'react'
import { OperatorAuthProvider } from './auth-provider'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Nivasa | Platform operations',
  description: 'Private platform operator console for onboarding, provisioning, campaigns, audit, and health',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <OperatorAuthProvider
          domain={process.env.AUTH0_DOMAIN ?? ''}
          clientId={process.env.AUTH0_OPERATOR_CLIENT_ID ?? ''}
          audience={process.env.AUTH0_AUDIENCE ?? ''}
          redirectUri={process.env.OPERATOR_WEB_PUBLIC_URL ?? 'http://localhost:3101'}
        >
          {children}
        </OperatorAuthProvider>
      </body>
    </html>
  )
}
