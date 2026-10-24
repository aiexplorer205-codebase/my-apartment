'use client'

import { createContext, useCallback, useContext, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet'
  children: ReactNode
}

export function Button({ variant = 'primary', className = '', children, ...props }: ButtonProps) {
  return <button className={`nivasa-button nivasa-button-${variant} ${className}`.trim()} {...props}>{children}</button>
}

type AppMessage = { id: number; text: string; kind: 'error' | 'success' | 'info' }
type AppMessagesContextValue = { pushMessage: (text: string, kind?: AppMessage['kind']) => void }
const AppMessagesContext = createContext<AppMessagesContextValue | null>(null)

export function AppMessagesProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<AppMessage[]>([])
  const messageId = useRef(0)
  const pushMessage = useCallback((text: string, kind: AppMessage['kind'] = 'info') => {
    messageId.current += 1
    setMessages((current) => [...current, { id: messageId.current, text, kind }])
  }, [])
  const dismissMessage = (id: number) => setMessages((current) => current.filter((message) => message.id !== id))

  return (
    <AppMessagesContext.Provider value={{ pushMessage }}>
      {children}
      <aside className="app-message-stack" aria-label="Notifications" aria-live="polite">
        {messages.map((message) => <section className={`app-message app-message-${message.kind}`} key={message.id} role={message.kind === 'error' ? 'alert' : 'status'}>
          <p>{message.text}</p>
          <button type="button" aria-label="Dismiss message" onClick={() => dismissMessage(message.id)}>×</button>
        </section>)}
      </aside>
    </AppMessagesContext.Provider>
  )
}

export function useAppMessages() {
  const context = useContext(AppMessagesContext)
  if (!context) throw new Error('useAppMessages must be used within AppMessagesProvider')
  return context
}

export { PwaControls } from './pwa-controls'
export { ComplaintHomeShortcut, Complaints, type ComplaintClient } from './complaints'
export { WorkspaceBreadcrumb, WorkspaceStatusTabs, WorkspaceFilter } from './workspace-navigation'
export { ReceiptReview } from './receipt-review'

export { AdminAssignmentControl } from './admin-assignment'
