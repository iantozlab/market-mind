CREATE TABLE public.psychology_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  strategy_name TEXT NOT NULL,
  win_rate DOUBLE PRECISION NOT NULL,
  trades INTEGER NOT NULL,
  is_healthy BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_psy_snapshots_strategy_time
  ON public.psychology_snapshots (strategy_name, created_at DESC);

ALTER TABLE public.psychology_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read psychology snapshots"
  ON public.psychology_snapshots FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert psychology snapshots"
  ON public.psychology_snapshots FOR INSERT
  WITH CHECK (true);