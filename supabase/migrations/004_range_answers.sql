-- Range answers: cross-session memory of "name an X" style answers so AIDEN
-- demonstrates breadth across sessions without polluting taste (preference mode).
-- Only written when queryMode === 'range'.

CREATE TABLE IF NOT EXISTS range_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  query_text TEXT NOT NULL,
  category_keywords TEXT[] NOT NULL DEFAULT '{}',
  answer TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_range_answers_tenant_recent
  ON range_answers(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_range_answers_keywords
  ON range_answers USING GIN (category_keywords);
