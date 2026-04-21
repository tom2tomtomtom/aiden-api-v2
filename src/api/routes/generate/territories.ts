/**
 * Territories Generation Endpoint
 *
 * POST /api/v1/generate/territories
 * Creates an async job that generates creative territories through the full brain.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { jobStore } from '../../jobs/store.js';
import { submitJob } from '../../jobs/runner.js';
import { processMessage } from '../../../brain/nuclear-brain.js';
import { createBrainServices } from '../../service-factory.js';

const router = Router();

const TerritoriesRequestSchema = z.object({
  brief_data: z.object({
    brand: z.string().min(1),
    category: z.string().min(1),
    target_audience: z.string().min(1),
    objectives: z.string().min(1),
    constraints: z.string().optional(),
    strategy: z.string().optional(),
  }),
  count: z.number().int().min(2).max(6).optional().default(3),
  model: z.string().optional(),
  webhook_url: z.string().url().optional(),
});

router.post('/generate/territories', async (req: Request, res: Response) => {
  const parsed = TerritoriesRequestSchema.safeParse(req.body);
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
    endpoint: '/api/v1/generate/territories',
    webhook_url,
  });

  const territoriesPrompt = `Generate ${count} distinct creative territories for this brief.

BRAND: ${brief_data.brand}
CATEGORY: ${brief_data.category}
TARGET AUDIENCE: ${brief_data.target_audience}
OBJECTIVES: ${brief_data.objectives}
${brief_data.constraints ? `CONSTRAINTS: ${brief_data.constraints}` : ''}
${brief_data.strategy ? `STRATEGY: ${brief_data.strategy}` : ''}

Each territory should have:
1. A name (evocative, 2-4 words)
2. A one-sentence positioning statement
3. The creative tension it exploits
4. The emotional register (how it makes people feel)
5. A reference example (a campaign or cultural moment that lives in this territory)

The territories must be genuinely different from each other. Not three versions of the same idea. Push for range.`;

  submitJob(jobId, async () => {
    const services = createBrainServices();
    const response = await processMessage(
      {
        message: territoriesPrompt,
        conversationId: `territories-${jobId}`,
        agencyId: tenantId,
        personalityMode: 'collaborator',
      },
      services,
    );
    return {
      territories: response.text,
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
