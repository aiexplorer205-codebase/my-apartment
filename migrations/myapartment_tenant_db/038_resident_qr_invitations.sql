SET LOCAL search_path = block9_tenant;
-- QR invitations authenticate possession of the admin-issued capability and a passkey.
-- Contact email is optional and is never treated as verified by QR registration.
ALTER TABLE resident_invitations ALTER COLUMN email DROP NOT NULL;
ALTER TABLE residents ALTER COLUMN email DROP NOT NULL;
ALTER TABLE resident_invitations ADD COLUMN delivery TEXT NOT NULL DEFAULT 'email' CHECK (delivery IN ('email','qr'));
ALTER TABLE resident_invitations ADD CONSTRAINT resident_invitations_email_delivery CHECK (delivery='qr' OR email IS NOT NULL);
