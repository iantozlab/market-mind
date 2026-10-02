DO $$
DECLARE
  target_table text;
  existing_policy record;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'arb_execution_audit',
    'metrics_snapshots',
    'psychology_snapshots',
    'rans_diagnostic_events',
    'trade_settings_audit'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS user_id uuid DEFAULT auth.uid()',
      target_table
    );
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN user_id SET DEFAULT auth.uid()',
      target_table
    );
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', target_table);
    EXECUTE format('GRANT SELECT, INSERT, DELETE ON public.%I TO authenticated', target_table);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', target_table);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (user_id)',
      target_table || '_user_id_idx', target_table
    );

    FOR existing_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', existing_policy.policyname, target_table);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() = user_id)',
      target_table || '_owner_select', target_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)',
      target_table || '_owner_insert', target_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (auth.uid() = user_id)',
      target_table || '_owner_delete', target_table
    );
  END LOOP;
END $$;