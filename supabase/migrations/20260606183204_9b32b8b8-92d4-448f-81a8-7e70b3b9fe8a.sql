
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE public.rans_diagnostic_events
  ADD COLUMN IF NOT EXISTS search_blob text GENERATED ALWAYS AS (
    event_type || ' ' || severity || ' ' ||
    coalesce(detail->>'title','') || ' ' ||
    coalesce(detail->>'reason','') || ' ' ||
    coalesce(detail->>'regime','') || ' ' ||
    coalesce(detail::text,'')
  ) STORED;

ALTER TABLE public.rans_diagnostic_events
  ADD COLUMN IF NOT EXISTS search_tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(detail->>'title','')), 'A') ||
    setweight(to_tsvector('simple', coalesce(detail->>'reason','')), 'A') ||
    setweight(to_tsvector('simple', event_type), 'B') ||
    setweight(to_tsvector('simple', coalesce(detail->>'regime','')), 'B') ||
    setweight(to_tsvector('simple', severity), 'C') ||
    setweight(to_tsvector('simple', coalesce(detail::text,'')), 'D')
  ) STORED;

CREATE INDEX IF NOT EXISTS rans_diag_search_tsv_idx
  ON public.rans_diagnostic_events USING GIN (search_tsv);

CREATE INDEX IF NOT EXISTS rans_diag_search_blob_trgm_idx
  ON public.rans_diagnostic_events USING GIN (search_blob gin_trgm_ops);
