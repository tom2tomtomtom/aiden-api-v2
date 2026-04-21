/**
 * Health Check Endpoint
 *
 * GET /api/v1/health
 * No auth required. Used by Railway health checks and monitoring.
 */

import { Router, type Request, type Response } from 'express';

const router = Router();

const VERSION = process.env.npm_package_version || '0.1.0';
const startedAt = new Date().toISOString();

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    version: VERSION,
    started_at: startedAt,
    phantom_count: 23, // Base phantom modules loaded
    campaign_count: 119, // Creative knowledge campaigns
    uptime_seconds: Math.floor(process.uptime()),
  });
});

export default router;
