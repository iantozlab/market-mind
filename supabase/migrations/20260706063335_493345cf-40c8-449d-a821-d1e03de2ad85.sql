CREATE TABLE public.metrics_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id text NOT NULL,
  captured_at timestamp with time zone NOT NULL DEFAULT now(),
  total_pnl double precision NOT NULL DEFAULT 0,
  daily_pnl double precision NOT NULL DEFAULT 0,
  win_rate double precision NOT NULL DEFAULT 0,
  sharpe_ratio double precision NOT NULL DEFAULT 0,
  max_drawdown double precision NOT NULL DEFAULT 0,
  active_positions integer NOT NULL DEFAULT 0,
  trades_executed integer NOT NULL DEFAULT 0,
  markets_monitored integer NOT NULL DEFAULT 0,
  anomaly_score double precision NOT NULL DEFAULT 0,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, DELETE ON public.metrics_snapshots TO anon;
GRANT SELECT, INSERT, DELETE ON public.metrics_snapshots TO authenticated;
GRANT ALL ON public.metrics_snapshots TO service_role;
ALTER TABLE public.metrics_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read metrics snapshots" ON public.metrics_snapshots FOR SELECT USING (true);
CREATE POLICY "Anyone can insert metrics snapshots" ON public.metrics_snapshots FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can prune metrics snapshots" ON public.metrics_snapshots FOR DELETE USING (true);
CREATE INDEX metrics_snapshots_session_time_idx ON public.metrics_snapshots (session_id, captured_at DESC);
CREATE INDEX metrics_snapshots_time_idx ON public.metrics_snapshots (captured_at DESC);