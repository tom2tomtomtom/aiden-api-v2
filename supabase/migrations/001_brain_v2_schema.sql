-- AIDEN Brain API v2 - Multi-tenant Schema
-- Supabase (PostgreSQL) with pgvector for semantic search

-- Enable vector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Tenants (companies licensing the brain) ──────────────────────────────────

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'starter',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── API Keys ─────────────────────────────────────────────────────────────────

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  key_prefix TEXT NOT NULL UNIQUE,
  key_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
  rate_limit_per_day INTEGER NOT NULL DEFAULT 1000,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  request_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Conversations ────────────────────────────────────────────────────────────

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  conversation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, conversation_id)
);

-- ── Messages ─────────────────────────────────────────────────────────────────

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  phantoms_fired JSONB,
  collisions JSONB,
  thinking_mode TEXT,
  maturity_stage TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add embedding column for semantic recall
ALTER TABLE messages ADD COLUMN embedding vector(1536);

-- ── Agency Phantoms (per-tenant cultivated) ──────────────────────────────────

CREATE TABLE agency_phantoms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  shorthand TEXT NOT NULL,
  feeling_seed TEXT NOT NULL,
  phantom_story TEXT NOT NULL,
  influence TEXT NOT NULL,
  word_triggers TEXT[] DEFAULT '{}',
  intent_triggers TEXT[] DEFAULT '{}',
  emotional_contexts TEXT[] DEFAULT '{}',
  conversation_contexts TEXT[] DEFAULT '{}',
  origin_context TEXT,
  weight NUMERIC(4,2) NOT NULL DEFAULT 3.0,
  quality_score NUMERIC(4,2),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Phantom Feedback (for learning from usage) ───────────────────────────────

CREATE TABLE phantom_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  phantoms_active JSONB NOT NULL,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('positive', 'negative', 'used', 'regenerated', 'edited')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Phantom Alliances ────────────────────────────────────────────────────────

CREATE TABLE phantom_alliances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  phantom_a_id TEXT NOT NULL,
  phantom_b_id TEXT NOT NULL,
  co_activation_count INTEGER NOT NULL DEFAULT 0,
  positive_co_activation_count INTEGER NOT NULL DEFAULT 0,
  alliance_strength NUMERIC(4,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, phantom_a_id, phantom_b_id)
);

-- ── Concepts ─────────────────────────────────────────────────────────────────

CREATE TABLE concepts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.5,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  graduated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Usage Logs ───────────────────────────────────────────────────────────────

CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  api_key_prefix TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd NUMERIC(10,6) DEFAULT 0,
  duration_ms INTEGER,
  status_code INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_embedding ON messages USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_agency_phantoms_tenant ON agency_phantoms(tenant_id);
CREATE INDEX idx_agency_phantoms_active ON agency_phantoms(tenant_id, is_active) WHERE is_active = true;
CREATE INDEX idx_phantom_feedback_tenant ON phantom_feedback(tenant_id, created_at DESC);
CREATE INDEX idx_phantom_alliances_tenant ON phantom_alliances(tenant_id);
CREATE INDEX idx_usage_tenant ON usage_logs(tenant_id, created_at DESC);
CREATE INDEX idx_concepts_tenant ON concepts(tenant_id);
CREATE INDEX idx_conversations_tenant ON conversations(tenant_id);

-- ── RPC Functions ────────────────────────────────────────────────────────────

-- Usage summary function for the usage endpoint
CREATE OR REPLACE FUNCTION get_usage_summary(
  p_tenant_id UUID,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ
) RETURNS JSON AS $$
  SELECT json_build_object(
    'requests', COUNT(*)::int,
    'input_tokens', COALESCE(SUM(input_tokens), 0)::int,
    'output_tokens', COALESCE(SUM(output_tokens), 0)::int,
    'cost_usd', COALESCE(SUM(cost_usd), 0)::numeric(10,4)
  )
  FROM usage_logs
  WHERE tenant_id = p_tenant_id
    AND created_at >= p_start
    AND created_at < p_end;
$$ LANGUAGE sql STABLE;
