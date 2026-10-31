SET search_path TO block9_tenant, public;

DROP TRIGGER IF EXISTS resident_complaint_message_versions_insert ON complaint_messages;
DROP TRIGGER IF EXISTS resident_complaint_message_versions_update ON complaint_messages;
DROP TRIGGER IF EXISTS resident_complaint_message_versions_delete ON complaint_messages;

DROP TRIGGER IF EXISTS resident_complaint_event_versions_insert ON complaint_events;
DROP TRIGGER IF EXISTS resident_complaint_event_versions_update ON complaint_events;
DROP TRIGGER IF EXISTS resident_complaint_event_versions_delete ON complaint_events;

DROP TRIGGER IF EXISTS resident_complaint_photo_versions_insert ON complaint_photos;
DROP TRIGGER IF EXISTS resident_complaint_photo_versions_update ON complaint_photos;
DROP TRIGGER IF EXISTS resident_complaint_photo_versions_delete ON complaint_photos;

DROP TRIGGER IF EXISTS resident_invoice_item_versions_insert ON invoice_items;
DROP TRIGGER IF EXISTS resident_invoice_item_versions_update ON invoice_items;
DROP TRIGGER IF EXISTS resident_invoice_item_versions_delete ON invoice_items;
