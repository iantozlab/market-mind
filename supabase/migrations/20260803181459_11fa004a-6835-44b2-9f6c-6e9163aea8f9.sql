CREATE TABLE public.arb_execution_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id text NOT NULL DEFAULT 'dashboard',
  source text NOT NULL,
  action text NOT NULL,
  mode text NOT NULL DEFAULT 'paper',
  label text,
  legs integer NOT NULL DEFAULT 0,
  profit double precision NOT NULL DEFAULT 0,
  capital double precision NOT NULL DEFAULT 0,
  confidence double precision NOT NULL DEFAULT 0,
  reason text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.arb_execution_audit TO anon, authenticated;
GRANT ALL ON public.arb_execution_audit TO service_role;
ALTER TABLE public.arb_execution_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read arb execution audit" ON public.arb_execution_audit FOR SELECT USING (true);
CREATE POLICY "Anyone can insert arb execution audit" ON public.arb_execution_audit FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can prune arb execution audit" ON public.arb_execution_audit FOR DELETE USING (true);
CREATE INDEX arb_execution_audit_created_at_idx ON public.arb_execution_audit (created_at DESC);