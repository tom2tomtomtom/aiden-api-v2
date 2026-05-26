/**
 * Conversation CRUD Endpoints
 *
 * Workspace-scoped reads/writes for client apps (Chat) that need explicit
 * conversation management beyond the implicit create-on-/chat behavior.
 *
 * All routes are tenant-scoped via authMiddleware (sets req.tenant_id).
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

// ── Schemas ───────────────────────────────────────────────────────────────────

const ListQuerySchema = z.object({
  workspace_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const CreateBodySchema = z.object({
  workspace_id: z.string().uuid().optional(),
  conversation_id: z.string().min(1).optional(),
  title: z.string().max(500).optional(),
  summary: z.string().max(2000).optional(),
});

const UpdateBodySchema = z.object({
  title: z.string().max(500).optional(),
  summary: z.string().max(2000).optional(),
  workspace_id: z.string().uuid().nullable().optional(),
});

const MessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.string().datetime().optional(),
});

// ── List ──────────────────────────────────────────────────────────────────────

router.get('/conversations', async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    res.status(401).json({ success: false, error: 'Invalid tenant' });
    return;
  }
  const parsed = ListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { workspace_id, limit, offset } = parsed.data;
  const supabase = getSupabase();

  let query = supabase
    .from('conversations')
    .select('id, conversation_id, workspace_id, title, summary, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (workspace_id) query = query.eq('workspace_id', workspace_id);

  const { data, error } = await query;
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }

  // Best-effort message counts (single grouped query).
  const ids = (data ?? []).map((c) => c.id);
  let counts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: msgRows } = await supabase
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', ids);
    counts = (msgRows ?? []).reduce<Record<string, number>>((acc, r) => {
      const k = (r as { conversation_id: string }).conversation_id;
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
  }

  res.json({
    success: true,
    data: {
      conversations: (data ?? []).map((c) => ({
        ...c,
        message_count: counts[c.id] ?? 0,
      })),
    },
  });
});

// ── Get one ───────────────────────────────────────────────────────────────────

router.get('/conversations/:id', async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    res.status(401).json({ success: false, error: 'Invalid tenant' });
    return;
  }
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) {
    res.status(400).json({ success: false, error: 'Invalid conversation id' });
    return;
  }
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('conversations')
    .select('id, conversation_id, workspace_id, title, summary, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }
  res.json({ success: true, data });
});

// ── Create ────────────────────────────────────────────────────────────────────

router.post('/conversations', async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    res.status(401).json({ success: false, error: 'Invalid tenant' });
    return;
  }
  const parsed = CreateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { workspace_id, conversation_id, title, summary } = parsed.data;
  const supabase = getSupabase();

  const conv_id = conversation_id || `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const { data, error } = await supabase
    .from('conversations')
    .insert({
      tenant_id: tenantId,
      conversation_id: conv_id,
      workspace_id: workspace_id ?? null,
      title: title ?? null,
      summary: summary ?? null,
    })
    .select('id, conversation_id, workspace_id, title, summary, created_at, updated_at')
    .single();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.status(201).json({ success: true, data });
});

// ── Update ────────────────────────────────────────────────────────────────────

router.put('/conversations/:id', async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    res.status(401).json({ success: false, error: 'Invalid tenant' });
    return;
  }
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) {
    res.status(400).json({ success: false, error: 'Invalid conversation id' });
    return;
  }
  const parsed = UpdateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ success: false, error: 'No fields to update' });
    return;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('conversations')
    .update(updates)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .select('id, conversation_id, workspace_id, title, summary, created_at, updated_at')
    .maybeSingle();

  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  if (!data) {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }
  res.json({ success: true, data });
});

// ── Delete ────────────────────────────────────────────────────────────────────

router.delete('/conversations/:id', async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    res.status(401).json({ success: false, error: 'Invalid tenant' });
    return;
  }
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) {
    res.status(400).json({ success: false, error: 'Invalid conversation id' });
    return;
  }
  const supabase = getSupabase();

  // Verify ownership before delete.
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle();
  if (!existing) {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }

  // Cascade-delete messages first (no DB FK exists between them today).
  await supabase.from('messages').delete().eq('conversation_id', id);
  const { error } = await supabase.from('conversations').delete().eq('id', id);
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true, data: { id, deleted: true } });
});

// ── Messages list ─────────────────────────────────────────────────────────────

router.get('/conversations/:id/messages', async (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    res.status(401).json({ success: false, error: 'Invalid tenant' });
    return;
  }
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) {
    res.status(400).json({ success: false, error: 'Invalid conversation id' });
    return;
  }
  const parsed = MessagesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { limit, before } = parsed.data;

  const supabase = getSupabase();

  // Tenant-scope through conversation ownership.
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle();
  if (!conv) {
    res.status(404).json({ success: false, error: 'Not found' });
    return;
  }

  let query = supabase
    .from('messages')
    .select('id, role, content, phantoms_fired, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) {
    res.status(500).json({ success: false, error: error.message });
    return;
  }
  res.json({ success: true, data: { messages: data ?? [] } });
});

export default router;
