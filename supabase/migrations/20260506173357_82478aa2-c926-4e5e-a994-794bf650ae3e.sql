CREATE POLICY "Anyone can prune old psychology snapshots"
ON public.psychology_snapshots
FOR DELETE
USING (true);

CREATE INDEX IF NOT EXISTS idx_psychology_snapshots_created_at
ON public.psychology_snapshots (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_psychology_snapshots_strategy_created
ON public.psychology_snapshots (strategy_name, created_at DESC);