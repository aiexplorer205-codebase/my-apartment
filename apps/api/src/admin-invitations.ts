import { createHash, randomBytes } from 'node:crypto'

export const createAdminInvitationToken = (): { token: string; tokenHash: string } => {
  const token = randomBytes(32).toString('base64url')
  return {
    token,
    tokenHash: createHash('sha256').update(token).digest('hex'),
  }
}

export const hashAdminInvitationToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex')

const escapeHtml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export const sendAdminInvitationEmail = async (input: {
  email: string
  organizationName: string
  invitationUrl: string
}): Promise<void> => {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.RESEND_FROM?.trim()
  if (!apiKey || !from || apiKey === 'replace-with-resend-key') {
    throw new Error('Configure RESEND_API_KEY and RESEND_FROM to send administrator invitations')
  }

  const response = await globalThis.fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.email],
      subject: `You're invited to manage ${input.organizationName} on MyApartment`,
      html: `<p>You have been invited to administer <strong>${escapeHtml(input.organizationName)}</strong> on MyApartment.</p><p>Sign in securely using an email one-time passcode sent to this email address. No username or password is needed.</p><p><a href="${escapeHtml(input.invitationUrl)}">Accept administrator invitation</a></p><p>This link expires in 7 days and can only be accepted by signing in with the invited email address.</p>`,
      text: `You have been invited to administer ${input.organizationName} on MyApartment.\n\nAccept the invitation: ${input.invitationUrl}\n\nSign in using an email one-time passcode sent to this email address. No username or password is needed. The link expires in 7 days.`,
    }),
  })
  if (!response.ok) {
    const responseText = await response.text()
    let detail = `Resend request failed (${response.status})`
    try {
      const payload = JSON.parse(responseText) as { message?: string }
      if (payload.message) detail = payload.message
    } catch {
      if (responseText) detail = `Resend request failed (${response.status})`
    }
    throw new Error(detail)
  }
}
