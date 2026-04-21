/**
 * Copy Suite Generation Endpoint
 *
 * POST /api/v1/generate/copy-suite
 * Creates an async job that generates a full copy suite through the full brain.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { jobStore } from '../../jobs/store.js';
import { submitJob } from '../../jobs/runner.js';
import { processMessage } from '../../../brain/nuclear-brain.js';
import { createBrainServices } from '../../service-factory.js';

const router = Router();

const CopySuiteRequestSchema = z.object({
  brief_data: z.object({
    brand: z.string().min(1),
    category: z.string().min(1),
    target_audience: z.string().min(1),
    objectives: z.string().min(1),
    constraints: z.string().optional(),
    big_idea: z.string().min(1),
    territory: z.string().optional(),
    tone_of_voice: z.string().optional(),
  }),
  formats: z.array(z.string()).optional().default(['social', 'headlines', 'youtube_ads']),
  model: z.string().optional(),
  webhook_url: z.string().url().optional(),
});

router.post('/generate/copy-suite', async (req: Request, res: Response) => {
  const parsed = CopySuiteRequestSchema.safeParse(req.body);
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
  const { brief_data, formats, webhook_url } = parsed.data;

  await jobStore.create({
    id: jobId,
    tenant_id: tenantId,
    endpoint: '/api/v1/generate/copy-suite',
    webhook_url,
  });

  const formatList = formats.join(', ');
  const copySuitePrompt = `Generate a complete copy suite for these formats: ${formatList}

BRAND: ${brief_data.brand}
CATEGORY: ${brief_data.category}
TARGET AUDIENCE: ${brief_data.target_audience}
OBJECTIVES: ${brief_data.objectives}
BIG IDEA: ${brief_data.big_idea}
${brief_data.constraints ? `CONSTRAINTS: ${brief_data.constraints}` : ''}
${brief_data.territory ? `TERRITORY: ${brief_data.territory}` : ''}
${brief_data.tone_of_voice ? `TONE OF VOICE: ${brief_data.tone_of_voice}` : ''}

For each format, provide:
- Multiple options (at least 3 per format)
- Varying lengths and approaches within each format
- A rationale for the strongest option

Write like a senior creative director. No filler. Every word earns its place.`;

  submitJob(jobId, async () => {
    const services = createBrainServices();
    const response = await processMessage(
      {
        message: copySuitePrompt,
        conversationId: `copysuite-${jobId}`,
        agencyId: tenantId,
        personalityMode: 'collaborator',
      },
      services,
    );
    return {
      copy_suite: response.text,
      formats_generated: formats,
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
