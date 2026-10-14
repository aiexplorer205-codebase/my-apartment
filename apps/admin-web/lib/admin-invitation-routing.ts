export const adminInvitationReturnToKey = 'nivasa.admin.invitation.returnTo'

export const isAdminInvitationReturnTo = (value: unknown): value is string =>
  typeof value === 'string'
  && value.startsWith('/invite?token=')
  && !value.startsWith('//')
