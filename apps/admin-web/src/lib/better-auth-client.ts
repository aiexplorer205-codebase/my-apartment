'use client'
import { createAuthClient } from 'better-auth/react'
import { emailOTPClient } from 'better-auth/client/plugins'
import { passkeyClient } from '@better-auth/passkey/client'

export const adminAuth = createAuthClient({ basePath: '/api/admin-auth', plugins: [emailOTPClient(), passkeyClient()] })
