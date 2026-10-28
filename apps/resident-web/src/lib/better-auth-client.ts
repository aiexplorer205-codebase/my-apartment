'use client'
import { createAuthClient } from 'better-auth/react'
import { emailOTPClient } from 'better-auth/client/plugins'
import { passkeyClient } from '@better-auth/passkey/client'

export const residentAuth = createAuthClient({ basePath: '/api/resident-auth', plugins: [emailOTPClient(), passkeyClient()] })
