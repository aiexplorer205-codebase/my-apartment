SET search_path TO block9_tenant, public;
ALTER TABLE complaint_messages ADD COLUMN payload_hash TEXT;
ALTER TABLE maintenance_actions DROP CONSTRAINT maintenance_actions_action_check;
ALTER TABLE maintenance_actions ADD CONSTRAINT maintenance_actions_action_check CHECK(action IN ('checklist','complete','assign'));
