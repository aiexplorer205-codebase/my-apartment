'use client'

import { PwaControls } from '@block9/ui'
import { useResidentAuth } from '../app/auth-provider'

export function AuthenticatedPwaControls({ appName }: { appName: string }) {
  const { isLoading, isAuthenticated } = useResidentAuth()
  if (isLoading || !isAuthenticated) return null
  return <PwaControls appName={appName} />
}
