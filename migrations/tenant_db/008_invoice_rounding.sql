ALTER TABLE invoice_items
  DROP CONSTRAINT IF EXISTS invoice_items_category_check;

ALTER TABLE invoice_items
  ADD CONSTRAINT invoice_items_category_check
    CHECK (category IN ('maintenance', 'water', 'sinking_fund', 'previous_dues', 'fees', 'round_off'));

ALTER TABLE invoice_items
  DROP CONSTRAINT IF EXISTS invoice_items_amount_minor_check;

ALTER TABLE invoice_items
  ADD CONSTRAINT invoice_items_amount_minor_check
    CHECK (amount_minor >= 0 OR category = 'round_off');
