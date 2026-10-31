# Login design QA

final result: blocked

Targets: supplied resident and admin login screenshots (2560 × 1520).
Implementation: apps/admin-web and apps/resident-web, unauthenticated entry screens.

Implemented the split brand panel, bilingual copy, language control, rounded white card, passkey-first choice, and progressive email/OTP entry. The requested passkey-first admin state intentionally differs from the supplied admin screenshot.

Visual comparison and browser interaction checks are blocked: this session exposes no in-app browser tools. No rendered screenshot comparison or live authentication verification is claimed.

Resident and admin authentication use isolated Better Auth services; resident Auth0 fallback and Auth0 browser SDK dependencies have been removed. Operator authentication remains on Auth0. Resident passkey sign-in uses the native WebAuthn popup; email OTP remains available for verification and recovery.

Validation: repository typecheck and lint passed; final admin/resident typechecks, lint, translation parity, and diff whitespace checks passed. Tests passed with a 20-second per-test timeout and permission to bind local test servers: 136 passed, 114 skipped. The default timeout failed the existing image decompression-bomb test; that test passed separately with the longer timeout. Database tests remain skipped without their configured database environment.

Repository build passed (13 tasks). Auth0 configuration/dependency and existing CSS compatibility warnings were emitted; live login still requires configured authentication services.
