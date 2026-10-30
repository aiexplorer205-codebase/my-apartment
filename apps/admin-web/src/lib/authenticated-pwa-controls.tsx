'use client'

import { PwaControls } from '@block9/ui'
import { useAuth0 } from '../app/auth-provider'

export function AuthenticatedPwaControls({ appName }: { appName: string }) {
  const { isLoading, isAuthenticated } = useAuth0()
  if (isLoading || !isAuthenticated) return null
  return <PwaControls appName={appName} />
}
