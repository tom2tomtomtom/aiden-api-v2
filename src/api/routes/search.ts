/**
 * Message Search Endpoint
 *
 * Currently text-only ilike search across messages, tenant-scoped, with
 * optional workspace_id filter via the parent conversation. Embedding-based
 * search can follow once messages carry an embedding column.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getSupabase } from '../service-factory.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getTenantId(req: Request): string | null {
  const tid = (req as unknown as Record<string, unknown>).tenant_id as string | undefined;
  return tid && UUID_RE.test(tid) ? tid : null;
}

const SearchBodySchema = z.object({
  query: z.string().min(1).max(500),
  workspace_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

router.post('/search/messages', async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    res.status(401).json({ success: false, error: 'Invalid tenant' });
    return;
  }
  const parsed = SearchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { query, workspace_id, limit } = parsed.data;
  const supabase = getSupabase();

  // Tenant-scope through conversations.
  let convQuery = supabase
    .from('conversations')
    .select('id')
    .eq('tenant_id', tenantId);
  if (workspace_id) convQuery = convQuery.eq('workspace_id', workspace_id);
  const { data: convs, error: convErr } = await convQuery;
  if (convErr) {
    res.status(500).json({ success: false, error: convErr.message });
    return;
  }
  const convIds = (convs ?? []).map((c) => c.id as string);
  if (convIds.length === 0) {
    res.json({ success: true, data: { messages: [] } });
    return;
  }

  // Escape ilike special chars in the query.
  const escaped = query.replace(/[%_\\]/g, (m) => '\\' + m);

  const { data, error } = await supabase
    .from('messages')
    .select('id, conversation_id, role, content, created_at')
    .in('conversation_id', convIds)
    .ilike('content', `%${escaped}%`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  res.json({
    success: true,
    data: {
      messages: (data ?? []).map((m) => ({
        id: m.id,
        conversation_id: m.conversation_id,
        role: m.role,
        content: m.content,
        created_at: m.created_at,
      })),
    },
  });
});

export default router;
