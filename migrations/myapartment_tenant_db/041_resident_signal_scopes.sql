SET search_path TO block9_tenant, public;

DO $$
DECLARE
  personal_trigger RECORD;
BEGIN
  FOR personal_trigger IN
    SELECT c.relname AS table_name, t.tgname AS trigger_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'block9_tenant'
      AND t.tgname ~ '^resident_(notice_read|poll_participation|complaint|profile|invoice|payment|financial|adjustment|credit|credit_use|account_entry|opening_credit|opening_balance)_versions_(insert|update|delete)$'
  LOOP
    EXECUTE format('DROP TRIGGER %I ON block9_tenant.%I', personal_trigger.trigger_name, personal_trigger.table_name);
  END LOOP;
END $$;

ALTER TABLE resident_change_versions DROP CONSTRAINT resident_change_versions_entity_check;
ALTER TABLE resident_change_versions ADD CONSTRAINT resident_change_versions_entity_check
  CHECK (entity IN ('notices','polls','updates','home','minutes','profile'));

DELETE FROM resident_change_versions WHERE entity IN ('complaints','payments');
