import { createHash, randomBytes } from 'node:crypto'

export const createResidentInvitationToken = (tenantId: string): { token: string; tokenHash: string } => {
  const token = `${tenantId}.${randomBytes(32).toString('base64url')}`
  return { token, tokenHash: createHash('sha256').update(token).digest('hex') }
}

export const hashResidentInvitationToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex')

const escapeHtml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export const sendResidentInvitationEmail = async (input: {
  email: string
  residentName: string
  organizationName: string
  unitLabel: string
  invitationUrl: string
}): Promise<void> => {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.RESEND_FROM?.trim()
  if (!apiKey || !from || apiKey === 'replace-with-resend-key') {
    throw new Error('Configure RESEND_API_KEY and RESEND_FROM to send resident invitations')
  }

  const response = await globalThis.fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [input.email],
      subject: `You're invited to ${input.organizationName} on Nivasa`,
      html: `<p>Hello ${escapeHtml(input.residentName)},</p><p>You have been invited to join <strong>${escapeHtml(input.organizationName)}</strong> for <strong>${escapeHtml(input.unitLabel)}</strong>.</p><p>Accept the invitation using the email one-time passcode sent to this address. The link expires in 7 days and only this verified email address can accept it.</p><p><a href="${escapeHtml(input.invitationUrl)}">Accept resident invitation</a></p>`,
      text: `Hello ${input.residentName},\n\nYou have been invited to join ${input.organizationName} for ${input.unitLabel}. Accept using an email one-time passcode sent to this address. The link expires in 7 days and only this verified email address can accept it.\n\nAccept the invitation: ${input.invitationUrl}`,
    }),
  })
  if (!response.ok) throw new Error(`Resident invitation email delivery failed (${response.status})`)
}
