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

  const bigIdeaPrompt = `Generate ${count} Big Ideas for this brief.

BRAND: ${brief_data.brand}
CATEGORY: ${brief_data.category}
TARGET AUDIENCE: ${brief_data.target_audience}
OBJECTIVES: ${brief_data.objectives}
${brief_data.constraints ? `CONSTRAINTS: ${brief_data.constraints}` : ''}
${brief_data.territory ? `CREATIVE TERRITORY: ${brief_data.territory}` : ''}
${brief_data.strategy ? `STRATEGY: ${brief_data.strategy}` : ''}

WHAT IS A BIG IDEA?
A Big Idea is NOT a tagline, slogan, or campaign theme. It is:
- An ORGANISING PRINCIPLE that unifies every creative execution
- A CREATIVE SPRINGBOARD that generates infinite expressions
- The answer to: "What is the one idea that makes this campaign inevitable?"

Classic Big Ideas for reference:
- Dove "Real Beauty" — challenge beauty standards with real women
- Apple "Think Different" — celebrate the crazy ones who change the world
- Nike "Just Do It" — action beats hesitation

For each of the ${count} ideas deliver, in this order:
1. TAGLINE — the campaign line that captures the Big Idea (max 10 words, memorable, could live on a billboard)
2. THE INSIGHT IT RESTS ON — a specific human truth, not a category claim
3. MANIFESTO — campaign philosophy that shows the idea in action through evocative language (50–100 words)
4. VISUAL METAPHOR — a single striking image that embodies the idea
5. EXPLORATIONS — 5–6 concrete creative executions across different touchpoints, each 1–2 sentences, producible
6. WHY IT WORKS — the strategic logic connecting insight to business outcome
7. THE RISK — what could go wrong, and why the idea is worth that risk

If you deliver more than one idea, sequence them from SAFE (smart but low-risk) → PUNCHY (makes a client nervous but excited) → BOLD (the idea you'd present if you knew they'd say yes).

Generate Big Ideas a creative director would be proud to present.`;

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
