import { redirect } from 'next/navigation'
import type { Route } from 'next'

export default function AdminEntryPage() {
  redirect((process.env.LOGIN_WEB_PUBLIC_URL ?? 'http://localhost:3099') as Route)
}
