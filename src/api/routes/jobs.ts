/**
 * Jobs Endpoint - Async job status and results
 *
 * GET /api/v1/jobs/:id/status
 * GET /api/v1/jobs/:id/result
 */

import { Router, type Request, type Response } from 'express';
import { jobStore } from '../jobs/store.js';

const router = Router();

// ── Job Status ────────────────────────────────────────────────────────────────

router.get('/jobs/:id/status', async (req: Request, res: Response) => {
  const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string;
  const job = await jobStore.get(req.params.id as string, tenantId);

  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found' });
    return;
  }

  res.json({
    success: true,
    data: {
      job_id: job.id,
      status: job.status,
      endpoint: job.endpoint,
      created_at: job.created_at,
      started_at: job.started_at,
      completed_at: job.completed_at,
      has_result: job.status === 'completed',
      error: job.error,
    },
  });
});

// ── Job Result ────────────────────────────────────────────────────────────────

router.get('/jobs/:id/result', async (req: Request, res: Response) => {
  const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string;
  const job = await jobStore.get(req.params.id as string, tenantId);

  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found' });
    return;
  }

  if (job.status === 'pending' || job.status === 'processing') {
    res.status(202).json({
      success: true,
      data: {
        job_id: job.id,
        status: job.status,
        message: 'Job is still running. Poll again shortly.',
      },
    });
    return;
  }

  if (job.status === 'failed') {
    res.status(422).json({
      success: false,
      error: job.error || 'Job failed',
      data: { job_id: job.id, status: 'failed' },
    });
    return;
  }

  res.json({
    success: true,
    data: {
      job_id: job.id,
      status: 'completed',
      result: job.data,
      completed_at: job.completed_at,
    },
  });
});

export default router;
