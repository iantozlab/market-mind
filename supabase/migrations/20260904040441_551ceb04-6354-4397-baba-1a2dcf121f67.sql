DO $$
DECLARE
  t text;
  p record;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'arb_execution_audit',
      'metrics_snapshots',
      'psychology_snapshots',
      'rans_diagnostic_events',
      'trade_settings_audit'
    ])
  LOOP
    FOR p IN
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;

    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

CREATE POLICY "Authenticated users can read arb execution audit"
  ON public.arb_execution_audit FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert arb execution audit"
  ON public.arb_execution_audit FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can prune arb execution audit"
  ON public.arb_execution_audit FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read metrics snapshots"
  ON public.metrics_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert metrics snapshots"
  ON public.metrics_snapshots FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can prune metrics snapshots"
  ON public.metrics_snapshots FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read psychology snapshots"
  ON public.psychology_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert psychology snapshots"
  ON public.psychology_snapshots FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can prune psychology snapshots"
  ON public.psychology_snapshots FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read rans diag events"
  ON public.rans_diagnostic_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert rans diag events"
  ON public.rans_diagnostic_events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can prune rans diag events"
  ON public.rans_diagnostic_events FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read trade settings audit"
  ON public.trade_settings_audit FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert trade settings audit"
  ON public.trade_settings_audit FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can prune trade settings audit"
  ON public.trade_settings_audit FOR DELETE TO authenticated USING (true);