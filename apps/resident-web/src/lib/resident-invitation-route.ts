type SearchParamsReader = { get(name: string): string | null }

export type ResidentInvitationRoute =
  | { kind: 'email'; token: string | null }
  | { kind: 'qr'; token: string | null }
  | { kind: 'invalid' }

export const resolveResidentInvitationRoute = (params: SearchParamsReader): ResidentInvitationRoute => {
  const type = params.get('type')
  if (type === 'email') return { kind: 'email', token: params.get('token') }
  if (type === 'qr') return { kind: 'qr', token: params.get('token') }

  const qrToken = params.get('qr') ?? params.get('qrToken')
  return qrToken ? { kind: 'qr', token: qrToken } : { kind: 'invalid' }
}
