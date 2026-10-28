-- Better Auth 1.7.14 core + passkey schemas. Run as migration owner, never at app startup.
SET LOCAL search_path = block9_platform;
CREATE TABLE resident_auth_user (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE, image TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE resident_auth_session (
  id TEXT PRIMARY KEY, "expiresAt" TIMESTAMPTZ NOT NULL, token TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ipAddress" TEXT, "userAgent" TEXT, "userId" TEXT NOT NULL REFERENCES resident_auth_user(id) ON DELETE CASCADE,
  "emailOtpVerifiedAt" TIMESTAMPTZ
);
CREATE INDEX resident_auth_session_user ON resident_auth_session("userId");
CREATE INDEX resident_auth_session_expiry ON resident_auth_session("expiresAt");
CREATE TABLE resident_auth_account (
  id TEXT PRIMARY KEY, "accountId" TEXT NOT NULL, "providerId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES resident_auth_user(id) ON DELETE CASCADE,
  "accessToken" TEXT, "refreshToken" TEXT, "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMPTZ, "refreshTokenExpiresAt" TIMESTAMPTZ, scope TEXT, password TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX resident_auth_account_user ON resident_auth_account("userId");
CREATE TABLE resident_auth_verification (
  id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX resident_auth_verification_identifier ON resident_auth_verification(identifier);
CREATE INDEX resident_auth_verification_expiry ON resident_auth_verification("expiresAt");
CREATE TABLE resident_auth_passkey (
  id TEXT PRIMARY KEY, name TEXT, "publicKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES resident_auth_user(id) ON DELETE CASCADE,
  "credentialID" TEXT NOT NULL UNIQUE, counter BIGINT NOT NULL, "deviceType" TEXT NOT NULL,
  "backedUp" BOOLEAN NOT NULL, transports TEXT, "createdAt" TIMESTAMPTZ DEFAULT NOW(), aaguid TEXT
);
CREATE INDEX resident_auth_passkey_user ON resident_auth_passkey("userId");
CREATE TABLE resident_auth_rate_limit (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, count INTEGER NOT NULL, "lastRequest" BIGINT NOT NULL);
CREATE TABLE resident_auth_email_limit (email TEXT PRIMARY KEY, sent_at TIMESTAMPTZ NOT NULL);
CREATE TABLE resident_auth_audit (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id TEXT NOT NULL, action TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
