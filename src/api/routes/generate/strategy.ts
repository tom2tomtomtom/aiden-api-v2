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

INSIGHT QUALITY STANDARDS. Every strategic insight you surface must meet all five:
1. HUMAN TRUTH: grounded in observable behaviour or emotion, not category claims
2. TENSION: contains an inherent contradiction or conflict that creates creative opportunity
3. NON-OBVIOUS: reveals something the audience knows but hasn't articulated
4. ACTIONABLE: points toward a clear creative direction
5. AUTHENTIC: rings true to the lived experience of the target audience

Bad insight: "Consumers want quality products." (generic, no tension)
Good insight: "People publicly celebrate hustle culture while privately craving permission to rest." (human truth + tension)

Deliver, in this order:
1. 5–7 strategic insights that meet the standards above (title + 1–2 sentence description each)
2. The core human problem (not business problem) and the authentic solution the campaign offers
3. The central creative tension that makes this campaign inevitable
4. Category conventions worth breaking and why
5. Brand opportunity — where this brand can credibly own a position
6. Communication strategy — what to say, how to say it, where to say it

Generate the strategy a creative director would actually be excited to brief.`;

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
