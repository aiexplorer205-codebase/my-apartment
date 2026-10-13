export type AuditEventType =
  | 'tenant.provisioned'
  | 'tenant.suspended'
  | 'invoice.created'
  | 'invoice.paid'
  | 'operator.action'
  | 'auth.login'

export interface AuditEvent {
  id: string
  tenantId?: string
  actorId?: string
  type: AuditEventType
  message: string
  createdAt: string
}
