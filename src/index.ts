import 'dotenv/config';
import { createApp } from './api/app.js';
import { shutdownServices } from './api/service-factory.js';
import { stopUsageTracking } from './api/middleware/usage-tracking.js';
import { config } from './config/index.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[AIDEN Brain API v2] Running on port ${config.port}`);
  console.log(`[AIDEN Brain API v2] Environment: ${config.nodeEnv}`);
  console.log(`[AIDEN Brain API v2] Health: http://localhost:${config.port}/api/v1/health`);
});

// ── Graceful Shutdown ─────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  console.log(`[AIDEN Brain API v2] ${signal} received. Shutting down gracefully...`);

  server.close(async () => {
    console.log('[AIDEN Brain API v2] HTTP server closed.');
    stopUsageTracking();
    await shutdownServices();
    console.log('[AIDEN Brain API v2] All services shut down.');
    process.exit(0);
  });

  // Force exit after 10s
  setTimeout(() => {
    console.error('[AIDEN Brain API v2] Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
