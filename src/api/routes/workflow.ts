/**
 * Workflow Endpoint - Guided creative pipeline
 *
 * POST /api/v1/workflow
 * POST /api/v1/workflow/:session_id
 * GET /api/v1/workflow/:session_id
 * DELETE /api/v1/workflow/:session_id
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sessionStore } from '../workflow/session.js';
import { handleWorkflowMessage } from '../workflow/orchestrator.js';

const router = Router();

const WorkflowMessageSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  session_id: z.string().optional(),
});

// ── Create session or send message ───────────────────────────────────────────

router.post('/workflow', async (req: Request, res: Response) => {
  const parsed = WorkflowMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string;
  const { message, session_id } = parsed.data;

  try {
    let session;
    if (session_id) {
      session = await sessionStore.get(session_id, tenantId);
      if (!session) {
        res.status(404).json({ success: false, error: 'Session not found' });
        return;
      }
    } else {
      session = await sessionStore.create(tenantId);
    }

    const response = await handleWorkflowMessage(session, message);

    res.json({ success: true, data: response });
  } catch (error) {
    console.error('[Workflow] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Workflow processing failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ── Send message to existing session ─────────────────────────────────────────

router.post('/workflow/:session_id', async (req: Request, res: Response) => {
  const parsed = z.object({ message: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'Message is required' });
    return;
  }

  const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string;
  const session = await sessionStore.get(req.params.session_id as string, tenantId);

  if (!session) {
    res.status(404).json({ success: false, error: 'Session not found' });
    return;
  }

  try {
    const response = await handleWorkflowMessage(session, parsed.data.message);
    res.json({ success: true, data: response });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Workflow processing failed',
    });
  }
});

// ── Get session state ────────────────────────────────────────────────────────

router.get('/workflow/:session_id', async (req: Request, res: Response) => {
  const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string;
  const session = await sessionStore.get(req.params.session_id as string, tenantId);

  if (!session) {
    res.status(404).json({ success: false, error: 'Session not found' });
    return;
  }

  res.json({
    success: true,
    data: {
      session_id: session.id,
      step: session.step,
      campaign_id: session.campaign_id,
      has_strategy: !!session.strategy,
      has_territories: !!session.territories,
      has_big_ideas: !!session.big_ideas,
      has_copy_suite: !!session.copy_suite,
      active_job_id: session.active_job_id,
      created_at: session.created_at,
      updated_at: session.updated_at,
    },
  });
});

// ── Delete session ───────────────────────────────────────────────────────────

router.delete('/workflow/:session_id', async (req: Request, res: Response) => {
  const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string;
  const deleted = await sessionStore.delete(req.params.session_id as string, tenantId);

  if (!deleted) {
    res.status(404).json({ success: false, error: 'Session not found' });
    return;
  }

  res.json({ success: true, message: 'Session deleted' });
});

export default router;
