CREATE TABLE public.order_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  mode text NOT NULL DEFAULT 'paper',
  market_label text,
  token_id text,
  side text NOT NULL,
  price double precision NOT NULL,
  size double precision NOT NULL,
  order_type text NOT NULL DEFAULT 'GTC',
  status text NOT NULL DEFAULT 'pending',
  http_status integer,
  polymarket_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  order_id text,
  retry_of uuid
);
GRANT SELECT, INSERT, DELETE ON public.order_audit_log TO authenticated;
GRANT ALL ON public.order_audit_log TO service_role;
ALTER TABLE public.order_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner can read" ON public.order_audit_log FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Owner can insert paper" ON public.order_audit_log FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND mode = 'paper');
CREATE POLICY "Owner can delete" ON public.order_audit_log FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX order_audit_log_user_created ON public.order_audit_log (user_id, created_at DESC);