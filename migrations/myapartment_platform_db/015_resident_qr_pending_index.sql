SET LOCAL search_path = block9_platform;
CREATE INDEX IF NOT EXISTS resident_auth_qr_pending_lookup_idx
  ON resident_auth_qr(user_id, status, expires_at)
  WHERE purpose='reset' AND status='pending';
