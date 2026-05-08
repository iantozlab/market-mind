CREATE TABLE public.trade_settings_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor TEXT NOT NULL DEFAULT 'dashboard-user',
  changes JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.trade_settings_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read trade settings audit"
  ON public.trade_settings_audit FOR SELECT USING (true);

CREATE POLICY "Anyone can insert trade settings audit"
  ON public.trade_settings_audit FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can prune trade settings audit"
  ON public.trade_settings_audit FOR DELETE USING (true);

CREATE INDEX idx_trade_settings_audit_created_at
  ON public.trade_settings_audit (created_at DESC);