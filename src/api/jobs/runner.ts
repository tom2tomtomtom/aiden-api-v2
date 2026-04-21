/**
 * Job Runner - Async job execution with webhook callbacks
 *
 * Runs brain tasks in the background and notifies via webhook on completion.
 * Uses HMAC-SHA256 signature on webhook payload for verification.
 */

import crypto from 'node:crypto';
import { jobStore } from './store.js';
import { config } from '../../config/index.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type JobExecutor = () => Promise<unknown>;

// ── Runner ────────────────────────────────────────────────────────────────────

/**
 * Submit and execute a job in the background.
 * Updates job store status and fires webhook on completion.
 */
export function submitJob(jobId: string, executor: JobExecutor): void {
  // Fire and forget - runs in background
  runJob(jobId, executor).catch((err) => {
    console.error(`[JobRunner] Unhandled error for job ${jobId}:`, err);
  });
}

async function runJob(jobId: string, executor: JobExecutor): Promise<void> {
  await jobStore.setProcessing(jobId);

  try {
    const result = await executor();
    const job = await jobStore.setCompleted(jobId, result);

    // Fire webhook if configured
    if (job?.webhook_url) {
      await fireWebhook(job.webhook_url, {
        job_id: jobId,
        status: 'completed',
        data: result,
        completed_at: job.completed_at,
      });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[JobRunner] Job ${jobId} failed:`, errorMsg);
    const job = await jobStore.setFailed(jobId, errorMsg);

    // Fire webhook with error
    if (job?.webhook_url) {
      await fireWebhook(job.webhook_url, {
        job_id: jobId,
        status: 'failed',
        error: errorMsg,
        completed_at: job.completed_at,
      });
    }
  }
}

// ── Webhook delivery ──────────────────────────────────────────────────────────

async function fireWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const body = JSON.stringify(payload);
    const signature = signPayload(body);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AIDEN-Signature': signature,
        'X-AIDEN-Timestamp': Date.now().toString(),
      },
      body,
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      console.warn(`[JobRunner] Webhook delivery failed: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    console.warn('[JobRunner] Webhook delivery error:', err instanceof Error ? err.message : err);
  }
}

/**
 * HMAC-SHA256 signature for webhook payload verification.
 * Recipients can verify by computing the same HMAC with their shared secret.
 */
function signPayload(body: string): string {
  const secret = config.apiKeySalt || 'aiden-webhook-secret';
  return crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
}
