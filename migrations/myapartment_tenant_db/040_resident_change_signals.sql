SET search_path TO block9_tenant, public;

ALTER TABLE resident_change_versions DROP CONSTRAINT resident_change_versions_entity_check;
ALTER TABLE resident_change_versions ADD CONSTRAINT resident_change_versions_entity_check
  CHECK (entity IN ('notices','polls','updates','home','complaints','minutes','profile','payments'));

INSERT INTO resident_change_versions(tenant_id,entity)
SELECT o.tenant_id,e.entity
FROM organizations o
CROSS JOIN unnest(ARRAY['complaints','minutes','profile','payments']) AS e(entity)
ON CONFLICT(tenant_id,entity) DO NOTHING;

CREATE OR REPLACE FUNCTION bump_resident_change_version(target_tenant TEXT, entities TEXT[])
RETURNS void
LANGUAGE plpgsql
SET search_path=block9_tenant,pg_catalog
AS $$
DECLARE entity_name TEXT;
BEGIN
  FOREACH entity_name IN ARRAY entities LOOP
    INSERT INTO resident_change_versions(tenant_id,entity,version,updated_at)
    VALUES(target_tenant,entity_name,1,NOW())
    ON CONFLICT(tenant_id,entity) DO UPDATE
      SET version=resident_change_versions.version+1,updated_at=NOW();
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION bump_resident_versions_from_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=block9_tenant,pg_catalog
AS $$
DECLARE
  transition_name TEXT;
  entity_names TEXT[] := string_to_array(TG_ARGV[0],',');
  tenant_expression TEXT := TG_ARGV[1];
  joins TEXT := TG_ARGV[2];
  tenant_ids TEXT[];
  tenant_id TEXT;
  source_sql TEXT;
BEGIN
  IF TG_OP='INSERT' THEN
    transition_name := 'new_rows';
    source_sql := format('SELECT %s AS tenant_id FROM %I r %s',tenant_expression,transition_name,joins);
  ELSIF TG_OP='DELETE' THEN
    transition_name := 'old_rows';
    source_sql := format('SELECT %s AS tenant_id FROM %I r %s',tenant_expression,transition_name,joins);
  ELSE
    source_sql := format(
      'SELECT %s AS tenant_id FROM new_rows r %s UNION SELECT %s AS tenant_id FROM old_rows r %s',
      tenant_expression,joins,tenant_expression,joins
    );
  END IF;
  EXECUTE format('SELECT array_agg(DISTINCT tenant_id) FROM (%s) changed WHERE tenant_id IS NOT NULL',source_sql)
    INTO tenant_ids;
  FOREACH tenant_id IN ARRAY COALESCE(tenant_ids,ARRAY[]::TEXT[]) LOOP
    PERFORM bump_resident_change_version(tenant_id,entity_names);
  END LOOP;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS resident_notice_versions ON notices;
DROP TRIGGER IF EXISTS resident_poll_versions ON polls;

CREATE TRIGGER resident_notice_versions_insert AFTER INSERT ON notices
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('notices,updates,home','r.tenant_id','');
CREATE TRIGGER resident_notice_versions_update AFTER UPDATE ON notices
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('notices,updates,home','r.tenant_id','');
CREATE TRIGGER resident_notice_versions_delete AFTER DELETE ON notices
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('notices,updates,home','r.tenant_id','');

CREATE TRIGGER resident_poll_versions_insert AFTER INSERT ON polls
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('polls,updates,home','r.tenant_id','');
CREATE TRIGGER resident_poll_versions_update AFTER UPDATE ON polls
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('polls,updates,home','r.tenant_id','');
CREATE TRIGGER resident_poll_versions_delete AFTER DELETE ON polls
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('polls,updates,home','r.tenant_id','');

CREATE TRIGGER resident_poll_option_versions_insert AFTER INSERT ON poll_options
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('polls,updates,home','p.tenant_id','JOIN polls p ON p.id=r.poll_id');
CREATE TRIGGER resident_poll_option_versions_update AFTER UPDATE ON poll_options
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('polls,updates,home','p.tenant_id','JOIN polls p ON p.id=r.poll_id');
CREATE TRIGGER resident_poll_option_versions_delete AFTER DELETE ON poll_options
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('polls,updates,home','p.tenant_id','JOIN polls p ON p.id=r.poll_id');

CREATE TRIGGER resident_notice_read_versions_insert AFTER INSERT ON notice_reads
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('updates,home','n.tenant_id','JOIN notices n ON n.id=r.notice_id');
CREATE TRIGGER resident_notice_read_versions_update AFTER UPDATE ON notice_reads
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('updates,home','n.tenant_id','JOIN notices n ON n.id=r.notice_id');
CREATE TRIGGER resident_notice_read_versions_delete AFTER DELETE ON notice_reads
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('updates,home','n.tenant_id','JOIN notices n ON n.id=r.notice_id');

CREATE TRIGGER resident_poll_participation_versions_insert AFTER INSERT ON poll_participation
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('updates,home','p.tenant_id','JOIN polls p ON p.id=r.poll_id');
CREATE TRIGGER resident_poll_participation_versions_update AFTER UPDATE ON poll_participation
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('updates,home','p.tenant_id','JOIN polls p ON p.id=r.poll_id');
CREATE TRIGGER resident_poll_participation_versions_delete AFTER DELETE ON poll_participation
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('updates,home','p.tenant_id','JOIN polls p ON p.id=r.poll_id');

CREATE TRIGGER resident_complaint_versions_insert AFTER INSERT ON complaints
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('complaints,home','r.tenant_id','');
CREATE TRIGGER resident_complaint_versions_update AFTER UPDATE ON complaints
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('complaints,home','r.tenant_id','');
CREATE TRIGGER resident_complaint_versions_delete AFTER DELETE ON complaints
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('complaints,home','r.tenant_id','');

CREATE TRIGGER resident_complaint_message_versions_insert AFTER INSERT ON complaint_messages
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('complaints,home','c.tenant_id','JOIN complaints c ON c.id=r.complaint_id');
CREATE TRIGGER resident_complaint_message_versions_update AFTER UPDATE ON complaint_messages
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('complaints,home','c.tenant_id','JOIN complaints c ON c.id=r.complaint_id');
CREATE TRIGGER resident_complaint_message_versions_delete AFTER DELETE ON complaint_messages
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('complaints,home','c.tenant_id','JOIN complaints c ON c.id=r.complaint_id');

CREATE TRIGGER resident_complaint_event_versions_insert AFTER INSERT ON complaint_events
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('complaints,home','c.tenant_id','JOIN complaints c ON c.id=r.complaint_id');
CREATE TRIGGER resident_complaint_event_versions_update AFTER UPDATE ON complaint_events
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('complaints,home','c.tenant_id','JOIN complaints c ON c.id=r.complaint_id');
CREATE TRIGGER resident_complaint_event_versions_delete AFTER DELETE ON complaint_events
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('complaints,home','c.tenant_id','JOIN complaints c ON c.id=r.complaint_id');

CREATE TRIGGER resident_complaint_photo_versions_insert AFTER INSERT ON complaint_photos
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('complaints,home','r.tenant_id','');
CREATE TRIGGER resident_complaint_photo_versions_update AFTER UPDATE ON complaint_photos
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('complaints,home','r.tenant_id','');
CREATE TRIGGER resident_complaint_photo_versions_delete AFTER DELETE ON complaint_photos
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('complaints,home','r.tenant_id','');

CREATE TRIGGER resident_minutes_versions_insert AFTER INSERT ON meeting_minutes
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('minutes,home','r.tenant_id','');
CREATE TRIGGER resident_minutes_versions_update AFTER UPDATE ON meeting_minutes
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('minutes,home','r.tenant_id','');
CREATE TRIGGER resident_minutes_versions_delete AFTER DELETE ON meeting_minutes
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('minutes,home','r.tenant_id','');

CREATE TRIGGER resident_minutes_attendee_versions_insert AFTER INSERT ON meeting_minutes_attendees
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('minutes,home','m.tenant_id','JOIN meeting_minutes m ON m.id=r.meeting_id');
CREATE TRIGGER resident_minutes_attendee_versions_update AFTER UPDATE ON meeting_minutes_attendees
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('minutes,home','m.tenant_id','JOIN meeting_minutes m ON m.id=r.meeting_id');
CREATE TRIGGER resident_minutes_attendee_versions_delete AFTER DELETE ON meeting_minutes_attendees
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('minutes,home','m.tenant_id','JOIN meeting_minutes m ON m.id=r.meeting_id');

CREATE TRIGGER resident_profile_versions_insert AFTER INSERT ON residents
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('profile,home','u.tenant_id','JOIN units u ON u.id=r.unit_id');
CREATE TRIGGER resident_profile_versions_update AFTER UPDATE ON residents
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('profile,home','u.tenant_id','JOIN units u ON u.id=r.unit_id');
CREATE TRIGGER resident_profile_versions_delete AFTER DELETE ON residents
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('profile,home','u.tenant_id','JOIN units u ON u.id=r.unit_id');

CREATE TRIGGER resident_organization_versions_insert AFTER INSERT ON organizations
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('profile,home','r.tenant_id','');
CREATE TRIGGER resident_organization_versions_update AFTER UPDATE ON organizations
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('profile,home','r.tenant_id','');
CREATE TRIGGER resident_organization_versions_delete AFTER DELETE ON organizations
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('profile,home','r.tenant_id','');

CREATE TRIGGER resident_unit_versions_insert AFTER INSERT ON units
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('profile,home','r.tenant_id','');
CREATE TRIGGER resident_unit_versions_update AFTER UPDATE ON units
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('profile,home','r.tenant_id','');
CREATE TRIGGER resident_unit_versions_delete AFTER DELETE ON units
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('profile,home','r.tenant_id','');

CREATE TRIGGER resident_building_versions_insert AFTER INSERT ON apartment_buildings
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('profile,home','r.tenant_id','');
CREATE TRIGGER resident_building_versions_update AFTER UPDATE ON apartment_buildings
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('profile,home','r.tenant_id','');
CREATE TRIGGER resident_building_versions_delete AFTER DELETE ON apartment_buildings
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('profile,home','r.tenant_id','');

CREATE TRIGGER resident_invoice_versions_insert AFTER INSERT ON invoices
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','u.tenant_id','JOIN residents resident ON resident.id=r.resident_id JOIN units u ON u.id=resident.unit_id');
CREATE TRIGGER resident_invoice_versions_update AFTER UPDATE ON invoices
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','u.tenant_id','JOIN residents resident ON resident.id=r.resident_id JOIN units u ON u.id=resident.unit_id');
CREATE TRIGGER resident_invoice_versions_delete AFTER DELETE ON invoices
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','u.tenant_id','JOIN residents resident ON resident.id=r.resident_id JOIN units u ON u.id=resident.unit_id');

CREATE TRIGGER resident_invoice_item_versions_insert AFTER INSERT ON invoice_items
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','u.tenant_id','JOIN invoices invoice ON invoice.id=r.invoice_id JOIN residents resident ON resident.id=invoice.resident_id JOIN units u ON u.id=resident.unit_id');
CREATE TRIGGER resident_invoice_item_versions_update AFTER UPDATE ON invoice_items
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','u.tenant_id','JOIN invoices invoice ON invoice.id=r.invoice_id JOIN residents resident ON resident.id=invoice.resident_id JOIN units u ON u.id=resident.unit_id');
CREATE TRIGGER resident_invoice_item_versions_delete AFTER DELETE ON invoice_items
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','u.tenant_id','JOIN invoices invoice ON invoice.id=r.invoice_id JOIN residents resident ON resident.id=invoice.resident_id JOIN units u ON u.id=resident.unit_id');

CREATE TRIGGER resident_payment_versions_insert AFTER INSERT ON payments
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','u.tenant_id','JOIN invoices invoice ON invoice.id=r.invoice_id JOIN residents resident ON resident.id=invoice.resident_id JOIN units u ON u.id=resident.unit_id');
CREATE TRIGGER resident_payment_versions_update AFTER UPDATE ON payments
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','u.tenant_id','JOIN invoices invoice ON invoice.id=r.invoice_id JOIN residents resident ON resident.id=invoice.resident_id JOIN units u ON u.id=resident.unit_id');
CREATE TRIGGER resident_payment_versions_delete AFTER DELETE ON payments
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','u.tenant_id','JOIN invoices invoice ON invoice.id=r.invoice_id JOIN residents resident ON resident.id=invoice.resident_id JOIN units u ON u.id=resident.unit_id');

CREATE TRIGGER resident_financial_versions_insert AFTER INSERT ON payment_reports
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');
CREATE TRIGGER resident_financial_versions_update AFTER UPDATE ON payment_reports
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');
CREATE TRIGGER resident_financial_versions_delete AFTER DELETE ON payment_reports
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');

CREATE TRIGGER resident_adjustment_versions_insert AFTER INSERT ON billing_adjustments
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');
CREATE TRIGGER resident_adjustment_versions_update AFTER UPDATE ON billing_adjustments
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');
CREATE TRIGGER resident_adjustment_versions_delete AFTER DELETE ON billing_adjustments
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');

CREATE TRIGGER resident_credit_versions_insert AFTER INSERT ON resident_credits
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');
CREATE TRIGGER resident_credit_versions_update AFTER UPDATE ON resident_credits
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');
CREATE TRIGGER resident_credit_versions_delete AFTER DELETE ON resident_credits
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');

CREATE TRIGGER resident_credit_use_versions_insert AFTER INSERT ON resident_credit_uses
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');
CREATE TRIGGER resident_credit_use_versions_update AFTER UPDATE ON resident_credit_uses
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');
CREATE TRIGGER resident_credit_use_versions_delete AFTER DELETE ON resident_credit_uses
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');

CREATE TRIGGER resident_account_entry_versions_insert AFTER INSERT ON account_entries
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');
CREATE TRIGGER resident_account_entry_versions_update AFTER UPDATE ON account_entries
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');
CREATE TRIGGER resident_account_entry_versions_delete AFTER DELETE ON account_entries
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');

CREATE TRIGGER resident_opening_credit_versions_insert AFTER INSERT ON opening_credit_allocations
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','u.tenant_id','JOIN invoices invoice ON invoice.id=r.invoice_id JOIN residents resident ON resident.id=invoice.resident_id JOIN units u ON u.id=resident.unit_id');
CREATE TRIGGER resident_opening_credit_versions_update AFTER UPDATE ON opening_credit_allocations
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','u.tenant_id','JOIN invoices invoice ON invoice.id=r.invoice_id JOIN residents resident ON resident.id=invoice.resident_id JOIN units u ON u.id=resident.unit_id');
CREATE TRIGGER resident_opening_credit_versions_delete AFTER DELETE ON opening_credit_allocations
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','u.tenant_id','JOIN invoices invoice ON invoice.id=r.invoice_id JOIN residents resident ON resident.id=invoice.resident_id JOIN units u ON u.id=resident.unit_id');

CREATE TRIGGER resident_opening_balance_versions_insert AFTER INSERT ON resident_opening_balances
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');
CREATE TRIGGER resident_opening_balance_versions_update AFTER UPDATE ON resident_opening_balances
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');
CREATE TRIGGER resident_opening_balance_versions_delete AFTER DELETE ON resident_opening_balances
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT
  EXECUTE FUNCTION bump_resident_versions_from_transition('home,payments','r.tenant_id','');
