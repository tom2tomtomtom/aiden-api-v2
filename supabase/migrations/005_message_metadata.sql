-- Message-level metadata (web-search citations, conviction mode, etc.)
-- Written by the brain on assistant turns and by client apps via
-- POST /conversations/:id/messages. Shape for citations:
--   { "citations": [{ "index": 1, "url": "...", "title": "...", "cited_text": "..." }] }
-- Applied to pplmhsnsfdayhnqrspxo on 2026-07-02 via MCP apply_migration.

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS metadata JSONB;
