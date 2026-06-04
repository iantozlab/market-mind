CREATE TABLE public.rans_diagnostic_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  severity text not null default 'info',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
GRANT SELECT, INSERT, DELETE ON public.rans_diagnostic_events TO anon;
GRANT SELECT, INSERT, DELETE ON public.rans_diagnostic_events TO authenticated;
GRANT ALL ON public.rans_diagnostic_events TO service_role;
ALTER TABLE public.rans_diagnostic_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read rans diag events" ON public.rans_diagnostic_events FOR SELECT USING (true);
CREATE POLICY "Anyone can insert rans diag events" ON public.rans_diagnostic_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can prune rans diag events" ON public.rans_diagnostic_events FOR DELETE USING (true);
CREATE INDEX rans_diag_events_created_idx ON public.rans_diagnostic_events (created_at DESC);
CREATE INDEX rans_diag_events_type_idx ON public.rans_diagnostic_events (event_type);