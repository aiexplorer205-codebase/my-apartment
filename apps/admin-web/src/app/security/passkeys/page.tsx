'use client'
import Link from 'next/link'
import { AdminPasskeyPrompt } from '../../../lib/admin-passkey-prompt'
export default function PasskeysPage() { return <AdminPasskeyPrompt settings><Link href="/dashboard">Return to admin portal</Link></AdminPasskeyPrompt> }
