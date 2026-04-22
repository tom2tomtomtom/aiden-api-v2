/**
 * Express App - Main application setup
 *
 * Mounts all routes under /api/v1, applies middleware,
 * handles errors, and provides graceful shutdown.
 */

import express, { type Request, type Response, type NextFunction } from 'express';


// Middleware
import { corsMiddleware } from './middleware/cors.js';
import { securityHeadersMiddleware } from './middleware/security-headers.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimiterMiddleware } from './middleware/rate-limiter.js';
import { tokenCapMiddleware } from './middleware/token-cap.js';
import { usageTrackingMiddleware } from './middleware/usage-tracking.js';

// Routes
import healthRouter from './routes/health.js';
import chatRouter from './routes/chat.js';
import jobsRouter from './routes/jobs.js';
import workflowRouter from './routes/workflow.js';
import keysRouter from './routes/keys.js';
import usageRouter from './routes/usage.js';
import phantomsRouter from './routes/phantoms.js';
import strategyRouter from './routes/generate/strategy.js';
import territoriesRouter from './routes/generate/territories.js';
import bigIdeaRouter from './routes/generate/big-idea.js';
import copySuiteRouter from './routes/generate/copy-suite.js';
import feedbackRouter from './routes/feedback.js';

// ── Create App ────────────────────────────────────────────────────────────────

export function createApp(): express.Application {
  const app = express();

  // ── Global middleware (before routes) ─────────────────────────────────────

  app.use(express.json());

  // Security headers on all responses
  app.use(securityHeadersMiddleware);

  // CORS
  app.use(corsMiddleware);

  // ── Public routes (no auth) ───────────────────────────────────────────────

  app.use('/api/v1', healthRouter);

  // ── Admin routes (require X-Admin-Secret only) ────────────────────────────

  app.use('/api/v1', keysRouter);

  // ── Protected routes (require API key) ────────────────────────────────────

  const protectedRouter = express.Router();

  // Auth + rate limiting + token cap + usage tracking
  protectedRouter.use(authMiddleware);
  protectedRouter.use(rateLimiterMiddleware as unknown as express.RequestHandler);
  protectedRouter.use(tokenCapMiddleware as unknown as express.RequestHandler);
  protectedRouter.use(usageTrackingMiddleware);

  // Mount protected route handlers
  protectedRouter.use(chatRouter);
  protectedRouter.use(jobsRouter);
  protectedRouter.use(workflowRouter);
  protectedRouter.use(usageRouter);
  protectedRouter.use(phantomsRouter);
  protectedRouter.use(strategyRouter);
  protectedRouter.use(territoriesRouter);
  protectedRouter.use(bigIdeaRouter);
  protectedRouter.use(copySuiteRouter);
  protectedRouter.use(feedbackRouter);

  app.use('/api/v1', protectedRouter);

  // ── 404 handler ───────────────────────────────────────────────────────────

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'Endpoint not found',
      hint: 'All endpoints are under /api/v1/. Check the docs.',
    });
  });

  // ── Error handler ─────────────────────────────────────────────────────────

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[App] Unhandled error:', err.message, err.stack);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      ...(process.env.NODE_ENV !== 'production' && { details: err.message }),
    });
  });

  return app;
}
