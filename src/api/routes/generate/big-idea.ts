/**
 * Big Idea Generation Endpoint
 *
 * POST /api/v1/generate/big-idea
 * Creates an async job that generates big creative ideas through the full brain.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { jobStore } from '../../jobs/store.js';
import { submitJob } from '../../jobs/runner.js';
import { processMessage } from '../../../brain/nuclear-brain.js';
import { createBrainServices } from '../../service-factory.js';

const router = Router();

const BigIdeaRequestSchema = z.object({
  brief_data: z.object({
    brand: z.string().min(1),
    category: z.string().min(1),
    target_audience: z.string().min(1),
    objectives: z.string().min(1),
    constraints: z.string().optional(),
    territory: z.string().optional(),
    strategy: z.string().optional(),
  }),
  count: z.number().int().min(1).max(5).optional().default(3),
  model: z.string().optional(),
  webhook_url: z.string().url().optional(),
});

router.post('/generate/big-idea', async (req: Request, res: Response) => {
  const parsed = BigIdeaRequestSchema.safeParse(req.body);
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
  const { brief_data, count, webhook_url } = parsed.data;

  await jobStore.create({
    id: jobId,
    tenant_id: tenantId,
    endpoint: '/api/v1/generate/big-idea',
    webhook_url,
  });

  const bigIdeaPrompt = `Generate ${count} big creative ideas for this brief.

BRAND: ${brief_data.brand}
CATEGORY: ${brief_data.category}
TARGET AUDIENCE: ${brief_data.target_audience}
OBJECTIVES: ${brief_data.objectives}
${brief_data.constraints ? `CONSTRAINTS: ${brief_data.constraints}` : ''}
${brief_data.territory ? `CREATIVE TERRITORY: ${brief_data.territory}` : ''}
${brief_data.strategy ? `STRATEGY: ${brief_data.strategy}` : ''}

For each idea:
1. A headline (the idea in one line)
2. The insight it rests on
3. How it manifests (what people see, hear, experience)
4. Why it works (the strategic logic)
5. The risk (what could go wrong)

These must be campaign-grade ideas, not taglines. Think Cannes Lions, not clip art.`;

  submitJob(jobId, async () => {
    const services = createBrainServices();
    const response = await processMessage(
      {
        message: bigIdeaPrompt,
        conversationId: `bigidea-${jobId}`,
        agencyId: tenantId,
        personalityMode: 'challenger',
      },
      services,
    );
    return {
      big_ideas: response.text,
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
