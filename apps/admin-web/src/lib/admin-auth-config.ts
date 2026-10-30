export function adminAuthURL(): string {
  const url = new URL(process.env.ADMIN_AUTH_INTERNAL_URL ?? 'http://localhost:4121')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/') throw new Error('Invalid admin auth service URL')
  return url.origin
}

export function sameAdminOrigin(request: globalThis.Request): boolean {
  return request.headers.get('origin') === new URL(process.env.APP_BASE_URL ?? 'http://localhost:3100').origin
}

// Next's cookie parser decodes the signed value; Better Auth expects its URI-encoded cookie representation.
export function adminSessionBearer(cookieValue: string): string {
  return `admin-session.${Buffer.from(encodeURIComponent(cookieValue)).toString('base64url')}`
}
