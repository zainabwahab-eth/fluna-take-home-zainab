CREATE TABLE IF NOT EXISTS company_mentions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT NOT NULL,
  requestor TEXT,
  status TEXT DEFAULT 'Running' CHECK (status IN ('Running', 'Completed', 'Failed')),
  mentions_output JSONB,
  error_message TEXT,
  quality_score INTEGER CHECK (quality_score BETWEEN 0 AND 100),
  quality_reasoning TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_company_mentions_company_status 
ON company_mentions (company_name, status, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE company_mentions;