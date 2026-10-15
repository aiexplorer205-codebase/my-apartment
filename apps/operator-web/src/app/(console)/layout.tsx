import type { ReactNode } from 'react'
import { OperatorAuthBoundary } from '../../lib/operator-auth-ui'

export default function OperatorConsoleLayout({ children }: { children: ReactNode }) {
  return <OperatorAuthBoundary>{children}</OperatorAuthBoundary>
}
