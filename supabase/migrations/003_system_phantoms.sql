-- AIDEN Brain v2 - Canonical system phantom library
-- Shared across all tenants. Not mutated by tenant feedback.
-- Populated from data/phantoms.json via scripts/seed-system-phantoms.ts
-- (run after applying this migration, idempotent on phantom_key).

CREATE TABLE system_phantoms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phantom_key TEXT UNIQUE NOT NULL,
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
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_system_phantoms_active ON system_phantoms(is_active) WHERE is_active = true;
