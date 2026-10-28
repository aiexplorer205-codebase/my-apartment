-- Fresh-install boundary: apply 001-035 followed by this migration to an EMPTY
-- shared application database. Existing customer data must never be inferred.
SET search_path TO block9_tenant, public;
SELECT pg_advisory_xact_lock(9049036);

DO $$
DECLARE t record; populated boolean;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='block9_tenant' LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM block9_tenant.%I)', t.tablename) INTO populated;
    IF populated THEN RAISE EXCEPTION 'Shared schema requires empty tables: % contains data', t.tablename; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='myapartment_runtime') THEN
    BEGIN
      CREATE ROLE myapartment_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='myapartment_lifecycle') THEN
    BEGIN
      CREATE ROLE myapartment_lifecycle NOLOGIN NOSUPERUSER NOBYPASSRLS;
    EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('myapartment_runtime','myapartment_lifecycle') AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'Runtime and lifecycle groups must be restricted NOLOGIN roles';
  END IF;
END $$;

-- Retain only a deletion marker, preventing already-authorized requests from
-- recreating data after a purge. The runtime may read but never alter markers.
CREATE TABLE tenant_tombstones(tenant_id TEXT PRIMARY KEY, deleted_at TIMESTAMPTZ NOT NULL DEFAULT now());

-- Save relationships before replacing their supporting unique constraints.
CREATE TEMP TABLE shared_foreign_keys AS
SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent,
       c.conname, c.confdeltype, c.confupdtype, c.condeferrable, c.condeferred,
       ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(n,ord)
         JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.n ORDER BY k.ord) AS child_columns,
       ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(n,ord)
         JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.n ORDER BY k.ord) AS parent_columns
FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
WHERE n.nspname='block9_tenant' AND c.contype='f';
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT * FROM shared_foreign_keys LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', f.child, f.conname);
  END LOOP;
END $$;

DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='block9_tenant' LOOP
    EXECUTE format('ALTER TABLE block9_tenant.%I ADD COLUMN IF NOT EXISTS tenant_id TEXT',t.tablename);
    EXECUTE format('ALTER TABLE block9_tenant.%I ALTER COLUMN tenant_id SET NOT NULL, ALTER COLUMN tenant_id SET DEFAULT nullif(current_setting(''app.tenant_id'',true),'''')',t.tablename);
    EXECUTE format('CREATE INDEX %I ON block9_tenant.%I(tenant_id)',t.tablename || '_tenant_scope_idx',t.tablename);
  END LOOP;
END $$;

-- Singleton settings are one row PER TENANT.
ALTER TABLE billing_rules DROP CONSTRAINT billing_rules_pkey;
ALTER TABLE billing_rules ADD PRIMARY KEY(tenant_id,id);

-- Every business uniqueness rule is tenant-local. UUID primary keys remain
-- globally unique; tenant-aware foreign keys below also enforce ownership.
DO $$
DECLARE c record; idx record; columns_sql text;
BEGIN
  FOR c IN SELECT conrelid::regclass AS rel, conname, conkey FROM pg_constraint
    WHERE connamespace='block9_tenant'::regnamespace AND contype='u'
  LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=c.rel AND attnum=ANY(c.conkey) AND attname='tenant_id') THEN
      SELECT string_agg(quote_ident(attname),',' ORDER BY ord) INTO columns_sql
        FROM unnest(c.conkey) WITH ORDINALITY k(n,ord) JOIN pg_attribute a ON a.attrelid=c.rel AND a.attnum=k.n;
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.rel,c.conname);
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I UNIQUE(tenant_id,%s)',c.rel,c.conname,columns_sql);
    END IF;
  END LOOP;
  FOR idx IN SELECT i.indexrelid::regclass AS rel, pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid
    WHERE t.relnamespace='block9_tenant'::regnamespace AND i.indisunique AND NOT i.indisprimary
      AND NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conindid=i.indexrelid)
      AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) AND a.attname='tenant_id')
  LOOP
    EXECUTE format('DROP INDEX %s',idx.rel);
    EXECUTE replace(idx.definition,'USING btree (','USING btree (tenant_id, ');
  END LOOP;
END $$;

DO $$
DECLARE f record; parent_cols text; child_cols text; delete_action text; update_action text; i integer := 0;
BEGIN
  FOR f IN SELECT * FROM shared_foreign_keys LOOP
    IF NOT ('tenant_id'=ANY(f.child_columns)) THEN
      f.child_columns := array_prepend('tenant_id',f.child_columns);
      f.parent_columns := array_prepend('tenant_id',f.parent_columns);
    END IF;
    SELECT string_agg(quote_ident(c),',') INTO child_cols FROM unnest(f.child_columns) c;
    SELECT string_agg(quote_ident(c),',') INTO parent_cols FROM unnest(f.parent_columns) c;
    i := i+1;
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %s(%s)','shared_fk_' || md5(f.parent || parent_cols),f.parent,parent_cols);
    delete_action := CASE f.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' WHEN 'r' THEN 'RESTRICT' ELSE 'NO ACTION' END;
    -- SET NULL only clears the optional reference, never tenant ownership.
    IF f.confdeltype='n' THEN
      delete_action := delete_action || ' (' || (SELECT string_agg(quote_ident(c),',') FROM unnest(f.child_columns) c WHERE c<>'tenant_id') || ')';
    END IF;
    update_action := CASE f.confupdtype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' WHEN 'r' THEN 'RESTRICT' ELSE 'NO ACTION' END;
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY(%s) REFERENCES %s(%s) ON DELETE %s ON UPDATE %s %s',
      f.child,f.conname,child_cols,f.parent,parent_cols,delete_action,update_action,
      CASE WHEN f.condeferrable THEN 'DEFERRABLE ' || CASE WHEN f.condeferred THEN 'INITIALLY DEFERRED' ELSE 'INITIALLY IMMEDIATE' END ELSE 'NOT DEFERRABLE' END);
  END LOOP;
END $$;
DROP TABLE shared_foreign_keys;

-- Views must use the caller's RLS policies rather than the migration owner's.
ALTER VIEW invoice_payment_credits SET (security_invoker=true);
REVOKE ALL ON SCHEMA block9_tenant FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA block9_tenant FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA block9_tenant FROM PUBLIC;
GRANT USAGE ON SCHEMA block9_tenant TO myapartment_runtime, myapartment_lifecycle;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA block9_tenant TO myapartment_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA block9_tenant TO myapartment_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA block9_tenant TO myapartment_runtime;
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='block9_tenant' LOOP
    EXECUTE format('ALTER TABLE block9_tenant.%I ENABLE ROW LEVEL SECURITY',t.tablename);
    EXECUTE format('ALTER TABLE block9_tenant.%I FORCE ROW LEVEL SECURITY',t.tablename);
    EXECUTE format('CREATE POLICY tenant_isolation ON block9_tenant.%I TO myapartment_runtime USING (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')) WITH CHECK (tenant_id=nullif(current_setting(''app.tenant_id'',true),''''))',t.tablename);
  END LOOP;
END $$;

REVOKE INSERT,UPDATE,DELETE ON tenant_tombstones FROM myapartment_runtime;

-- Deliberately separate from normal DELETE: published history remains immutable
-- during product use. Only the lifecycle credential can purge an entire tenant.
-- The function has no dynamic caller-supplied identifiers and restores trigger
-- behavior before returning. Exceptions roll back the local setting and deletes.
CREATE FUNCTION purge_tenant(target_tenant TEXT) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t record; previous_mode text;
BEGIN
  IF target_tenant IS NULL OR btrim(target_tenant)='' THEN RAISE EXCEPTION 'Tenant required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(target_tenant || ':purge',0));
  previous_mode := current_setting('session_replication_role');
  PERFORM set_config('session_replication_role','replica',true);
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='block9_tenant' LOOP
    EXECUTE format('DELETE FROM block9_tenant.%I WHERE tenant_id=$1',t.tablename) USING target_tenant;
  END LOOP;
  INSERT INTO block9_tenant.tenant_tombstones(tenant_id) VALUES(target_tenant);
  PERFORM set_config('session_replication_role',previous_mode,true);
END $$;
REVOKE ALL ON FUNCTION purge_tenant(TEXT) FROM PUBLIC, myapartment_runtime;
GRANT EXECUTE ON FUNCTION purge_tenant(TEXT) TO myapartment_lifecycle;
