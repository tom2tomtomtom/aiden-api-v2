/**
 * Workflow Session - Redis-backed session state for the guided pipeline
 *
 * State machine: INITIAL > BRIEF_EXTRACTED > STRATEGY > TERRITORIES >
 * TERRITORY_SELECTED > BIG_IDEA > BIG_IDEA_SELECTED > COPY_SUITE > DONE
 */

import { getRedis } from '../service-factory.js';

// ── Workflow Steps ────────────────────────────────────────────────────────────

export enum WorkflowStep {
  INITIAL = 'initial',
  BRIEF_EXTRACTED = 'brief_extracted',
  STRATEGY_GENERATING = 'strategy_generating',
  STRATEGY_READY = 'strategy_ready',
  TERRITORIES_GENERATING = 'territories_generating',
  TERRITORIES_READY = 'territories_ready',
  TERRITORY_SELECTED = 'territory_selected',
  BIG_IDEA_GENERATING = 'big_idea_generating',
  BIG_IDEA_READY = 'big_idea_ready',
  BIG_IDEA_SELECTED = 'big_idea_selected',
  COPY_SUITE_GENERATING = 'copy_suite_generating',
  COPY_SUITE_READY = 'copy_suite_ready',
  DONE = 'done',
}

export const DECISION_STEPS = new Set([
  WorkflowStep.TERRITORIES_READY,
  WorkflowStep.BIG_IDEA_READY,
]);

export const ASYNC_STEPS = new Set([
  WorkflowStep.STRATEGY_GENERATING,
  WorkflowStep.TERRITORIES_GENERATING,
  WorkflowStep.BIG_IDEA_GENERATING,
  WorkflowStep.COPY_SUITE_GENERATING,
]);

// ── Session Data ──────────────────────────────────────────────────────────────

export interface WorkflowSession {
  id: string;
  tenant_id: string;
  step: WorkflowStep;
  campaign_id: string;
  brief_data: Record<string, unknown> | null;
  strategy: string | null;
  territories: string | null;
  selected_territory: string | null;
  big_ideas: string | null;
  selected_big_idea: string | null;
  copy_suite: string | null;
  selected_formats: string[];
  active_job_id: string | null;
  messages: Array<{ role: string; content: string }>;
  created_at: number;
  updated_at: number;
}

// ── Session Store ─────────────────────────────────────────────────────────────

const SESSION_PREFIX = 'brain:session:';
const SESSION_TTL_SECONDS = 7200; // 2 hours

const memoryStore = new Map<string, WorkflowSession>();

export const sessionStore = {
  async create(tenantId: string): Promise<WorkflowSession> {
    const id = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session: WorkflowSession = {
      id,
      tenant_id: tenantId,
      step: WorkflowStep.INITIAL,
      campaign_id: `campaign-${id}`,
      brief_data: null,
      strategy: null,
      territories: null,
      selected_territory: null,
      big_ideas: null,
      selected_big_idea: null,
      copy_suite: null,
      selected_formats: ['social', 'youtube_ads'],
      active_job_id: null,
      messages: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    await this.save(session);
    return session;
  },

  async get(sessionId: string, tenantId: string): Promise<WorkflowSession | null> {
    const redis = await getRedis();
    if (redis) {
      const raw = await redis.get(`${SESSION_PREFIX}${sessionId}`);
      if (!raw) return null;
      const session: WorkflowSession = JSON.parse(raw);
      if (session.tenant_id !== tenantId) return null;
      return session;
    }

    const session = memoryStore.get(sessionId);
    if (!session || session.tenant_id !== tenantId) return null;
    return session;
  },

  async save(session: WorkflowSession): Promise<void> {
    session.updated_at = Date.now();
    const redis = await getRedis();
    if (redis) {
      await redis.set(
        `${SESSION_PREFIX}${session.id}`,
        JSON.stringify(session),
        'EX',
        SESSION_TTL_SECONDS,
      );
    } else {
      memoryStore.set(session.id, session);
    }
  },

  async delete(sessionId: string, tenantId: string): Promise<boolean> {
    const redis = await getRedis();
    if (redis) {
      const raw = await redis.get(`${SESSION_PREFIX}${sessionId}`);
      if (!raw) return false;
      const session: WorkflowSession = JSON.parse(raw);
      if (session.tenant_id !== tenantId) return false;
      await redis.del(`${SESSION_PREFIX}${sessionId}`);
      return true;
    }

    const session = memoryStore.get(sessionId);
    if (!session || session.tenant_id !== tenantId) return false;
    memoryStore.delete(sessionId);
    return true;
  },
};
