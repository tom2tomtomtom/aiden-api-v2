/**
 * Strategy Generation Endpoint
 *
 * POST /api/v1/generate/strategy
 * Creates an async job that generates creative strategy through the full brain.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { jobStore } from '../../jobs/store.js';
import { submitJob } from '../../jobs/runner.js';
import { processMessage } from '../../../brain/nuclear-brain.js';
import { createBrainServices } from '../../service-factory.js';

const router = Router();

const StrategyRequestSchema = z.object({
  brief_data: z.object({
    brand: z.string().min(1),
    category: z.string().min(1),
    target_audience: z.string().min(1),
    objectives: z.string().min(1),
    constraints: z.string().optional(),
    additional_context: z.string().optional(),
  }),
  model: z.string().optional(),
  webhook_url: z.string().url().optional(),
});

router.post('/generate/strategy', async (req: Request, res: Response) => {
  const parsed = StrategyRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string;
  const jobId = `job-${crypto.randomUUID()}`;
  const { brief_data, webhook_url } = parsed.data;

  await jobStore.create({
    id: jobId,
    tenant_id: tenantId,
    endpoint: '/api/v1/generate/strategy',
    webhook_url,
  });

  // Build the strategy generation prompt
  const strategyPrompt = `Generate a comprehensive creative strategy for this brief.

BRAND: ${brief_data.brand}
CATEGORY: ${brief_data.category}
TARGET AUDIENCE: ${brief_data.target_audience}
OBJECTIVES: ${brief_data.objectives}
${brief_data.constraints ? `CONSTRAINTS: ${brief_data.constraints}` : ''}
${brief_data.additional_context ? `ADDITIONAL CONTEXT: ${brief_data.additional_context}` : ''}

Deliver:
1. Strategic insight (the human truth that unlocks this brief)
2. Category tensions (what the category always does vs what it should do)
3. Brand opportunity (where this brand can credibly own a position)
4. Communication strategy (what to say, how to say it, where to say it)
5. Success metrics (how we know this worked)

Be specific. Be bold. Challenge the obvious.`;

  submitJob(jobId, async () => {
    const services = createBrainServices();
    const response = await processMessage(
      {
        message: strategyPrompt,
        conversationId: `strategy-${jobId}`,
        agencyId: tenantId,
        personalityMode: 'challenger',
      },
      services,
    );
    return {
      strategy: response.text,
      phantoms_fired: response.metadata.activatedPhantoms.map(p => p.phantom.shorthand),
      thinking_mode: response.metadata.thinkingMode.mode,
    };
  });

  res.status(202).json({
    success: true,
    data: {
      job_id: jobId,
      status: 'pending',
      poll_url: `/api/v1/jobs/${jobId}/status`,
    },
  });
});

export default router;
