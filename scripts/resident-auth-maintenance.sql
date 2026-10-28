-- Run periodically using the auth service login, from an external scheduler or maintenance runbook.
-- Keep the audit trail; its retention policy is an operator decision.
DELETE FROM block9_platform.resident_auth_verification WHERE "expiresAt" < NOW();
DELETE FROM block9_platform.resident_auth_session WHERE "expiresAt" < NOW();
DELETE FROM block9_platform.resident_auth_email_limit WHERE sent_at < NOW() - INTERVAL '1 day';
DELETE FROM block9_platform.resident_auth_rate_limit WHERE "lastRequest" < EXTRACT(EPOCH FROM NOW() - INTERVAL '1 day') * 1000;
