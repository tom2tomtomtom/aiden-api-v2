/**
 * Job Store - Redis-backed with in-memory fallback
 *
 * Stores async job state for structured generation endpoints.
 * Jobs are tenant-scoped and have configurable TTL.
 */

import { getRedis } from '../service-factory.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Job {
  id: string;
  tenant_id: string;
  status: JobStatus;
  endpoint: string;
  data: unknown | null;
  error: string | null;
  webhook_url: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

// ── Configuration ─────────────────────────────────────────────────────────────

const JOB_TTL_SECONDS = 3600; // 1 hour
const JOB_PREFIX = 'brain:job:';

// ── In-memory fallback store ──────────────────────────────────────────────────

const memoryStore = new Map<string, Job>();

function cleanupMemory(): void {
  const cutoff = Date.now() - JOB_TTL_SECONDS * 1000;
  for (const [id, job] of memoryStore) {
    if (job.created_at < cutoff) {
      memoryStore.delete(id);
    }
  }
}

// ── Job Store ─────────────────────────────────────────────────────────────────

export const jobStore = {
  async create(opts: {
    id: string;
    tenant_id: string;
    endpoint: string;
    webhook_url?: string;
  }): Promise<Job> {
    const job: Job = {
      id: opts.id,
      tenant_id: opts.tenant_id,
      status: 'pending',
      endpoint: opts.endpoint,
      data: null,
      error: null,
      webhook_url: opts.webhook_url || null,
      created_at: Date.now(),
      started_at: null,
      completed_at: null,
    };

    const redis = await getRedis();
    if (redis) {
      await redis.set(
        `${JOB_PREFIX}${job.id}`,
        JSON.stringify(job),
        'EX',
        JOB_TTL_SECONDS,
      );
    } else {
      cleanupMemory();
      memoryStore.set(job.id, job);
    }

    return job;
  },

  async get(id: string, tenant_id: string): Promise<Job | null> {
    const redis = await getRedis();
    if (redis) {
      const raw = await redis.get(`${JOB_PREFIX}${id}`);
      if (!raw) return null;
      const job: Job = JSON.parse(raw);
      if (job.tenant_id !== tenant_id) return null;
      return job;
    }

    const job = memoryStore.get(id);
    if (!job || job.tenant_id !== tenant_id) return null;
    return job;
  },

  async setProcessing(id: string): Promise<void> {
    const redis = await getRedis();
    if (redis) {
      const raw = await redis.get(`${JOB_PREFIX}${id}`);
      if (!raw) return;
      const job: Job = JSON.parse(raw);
      job.status = 'processing';
      job.started_at = Date.now();
      await redis.set(`${JOB_PREFIX}${id}`, JSON.stringify(job), 'EX', JOB_TTL_SECONDS);
    } else {
      const job = memoryStore.get(id);
      if (job) {
        job.status = 'processing';
        job.started_at = Date.now();
      }
    }
  },

  async setCompleted(id: string, data: unknown): Promise<Job | null> {
    const redis = await getRedis();
    if (redis) {
      const raw = await redis.get(`${JOB_PREFIX}${id}`);
      if (!raw) return null;
      const job: Job = JSON.parse(raw);
      job.status = 'completed';
      job.data = data;
      job.completed_at = Date.now();
      await redis.set(`${JOB_PREFIX}${id}`, JSON.stringify(job), 'EX', JOB_TTL_SECONDS);
      return job;
    }

    const job = memoryStore.get(id);
    if (job) {
      job.status = 'completed';
      job.data = data;
      job.completed_at = Date.now();
    }
    return job || null;
  },

  async setFailed(id: string, error: string): Promise<Job | null> {
    const redis = await getRedis();
    if (redis) {
      const raw = await redis.get(`${JOB_PREFIX}${id}`);
      if (!raw) return null;
      const job: Job = JSON.parse(raw);
      job.status = 'failed';
      job.error = error;
      job.completed_at = Date.now();
      await redis.set(`${JOB_PREFIX}${id}`, JSON.stringify(job), 'EX', JOB_TTL_SECONDS);
      return job;
    }

    const job = memoryStore.get(id);
    if (job) {
      job.status = 'failed';
      job.error = error;
      job.completed_at = Date.now();
    }
    return job || null;
  },
};
