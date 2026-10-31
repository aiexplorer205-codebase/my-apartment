export function residentAuthURL(): string {
  const url = new URL(process.env.RESIDENT_AUTH_INTERNAL_URL ?? 'http://localhost:4120')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/') throw new Error('Invalid resident auth service URL')
  return url.origin
}

export function sameResidentOrigin(request: globalThis.Request): boolean {
  return request.headers.get('origin') === new URL(process.env.APP_BASE_URL ?? 'http://localhost:3098').origin
}

// Next's cookie parser decodes the signed value; Better Auth expects its URI-encoded cookie representation.
export function residentSessionBearer(cookieValue: string): string {
  return `resident-session.${Buffer.from(encodeURIComponent(cookieValue)).toString('base64url')}`
}
