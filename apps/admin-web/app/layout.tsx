import './globals.css'
import type { ReactNode } from 'react'
import { AuthProvider } from './auth-provider'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Nivasa | Resident & admin operations',
  description: 'Tenant-aware apartment operations and billing platform',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider
          domain={process.env.AUTH0_DOMAIN ?? ''}
          clientId={process.env.AUTH0_ADMIN_CLIENT_ID ?? process.env.AUTH0_CLIENT_ID ?? ''}
          audience={process.env.AUTH0_AUDIENCE ?? ''}
          redirectUri={process.env.ADMIN_WEB_PUBLIC_URL ?? 'http://localhost:3100'}
        >
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
