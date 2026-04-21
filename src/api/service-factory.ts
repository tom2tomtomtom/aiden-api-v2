/**
 * Service Factory - Instantiates brain services from config
 *
 * Creates the dependency injection layer that connects the brain
 * to database, LLM, and search providers.
 */

import { config } from '../config/index.js';
import type {
  PhantomPoolProvider,
  SemanticSearchProvider,
  Phantom,
  AgencyPhantom,
  PhantomPackItem,
} from '../types.js';
import { HaikuAnalyzer } from '../brain/haiku-analyzer.js';
import { LLMAdapter, createPrimaryAdapter } from '../brain/llm-adapter.js';
import type { BrainServices } from '../brain/nuclear-brain.js';

// ── Database client (lazy) ────────────────────────────────────────────────────

let supabaseClient: ReturnType<typeof createSupabaseClient> | null = null;

function createSupabaseClient() {
  // Dynamic import to avoid requiring supabase at module load
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require('@supabase/supabase-js');
  return createClient(config.supabaseUrl, config.supabaseServiceKey);
}

export function getSupabase() {
  if (!supabaseClient) {
    supabaseClient = createSupabaseClient();
  }
  return supabaseClient;
}

// ── Redis client (lazy) ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let redisClient: any = null;

export async function getRedis(): Promise<{ get: (key: string) => Promise<string | null>; set: (...args: unknown[]) => Promise<unknown>; del: (key: string) => Promise<number>; incr: (key: string) => Promise<number>; expire: (key: string, seconds: number) => Promise<number>; ttl: (key: string) => Promise<number>; quit: () => Promise<string> } | null> {
  if (!config.redisUrl) return null;
  if (redisClient) return redisClient;

  const { Redis } = await import('ioredis');
  redisClient = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  await redisClient.connect();
  return redisClient;
}

// ── Phantom Pool Provider (Supabase-backed) ──────────────────────────────────

class SupabasePhantomPoolProvider implements PhantomPoolProvider {
  async loadPool(agencyId: string): Promise<{
    basePhantoms: Map<string, Phantom>;
    agencyPhantoms: AgencyPhantom[];
    packPhantoms: PhantomPackItem[];
  }> {
    const db = getSupabase();

    // Load base phantoms from config (these are baked in, not per-tenant)
    const basePhantoms = new Map<string, Phantom>();
    // Base phantoms come from the phantom-defaults config, loaded at startup
    // For now return empty; the brain has built-in fallbacks
    // TODO: Load from phantom-defaults.json

    // Load agency-specific phantoms
    let agencyPhantoms: AgencyPhantom[] = [];
    if (db && agencyId) {
      const { data } = await db
        .from('agency_phantoms')
        .select('*')
        .eq('tenant_id', agencyId)
        .eq('is_active', true);

      if (data) {
        agencyPhantoms = data.map((row: Record<string, unknown>) => ({
          id: row.id as string,
          agencyId: row.tenant_id as string,
          shorthand: row.shorthand as string,
          feelingSeed: row.feeling_seed as string,
          phantomStory: row.phantom_story as string,
          influence: row.influence as string,
          weight: Number(row.weight) || 3.0,
          wordTriggers: row.word_triggers as string[] || [],
          originContext: row.origin_context as string || '',
          qualityScore: row.quality_score ? Number(row.quality_score) : undefined,
          isActive: true,
        }));
      }
    }

    return { basePhantoms, agencyPhantoms, packPhantoms: [] };
  }
}

// ── Semantic Search Provider (Supabase pgvector) ─────────────────────────────

class SupabaseSearchProvider implements SemanticSearchProvider {
  async search(options: {
    agencyId: string;
    workspaceId?: string;
    query: string;
    matchThreshold?: number;
    matchCount?: number;
    sources?: string[];
  }): Promise<Array<{ id: string; content: string; similarity: number; metadata?: Record<string, unknown> }>> {
    // pgvector semantic search requires embedding the query first
    // For now, return empty results; wiring embeddings is a future step
    return [];
  }
}

// ── Service Factory ──────────────────────────────────────────────────────────

export function createBrainServices(overrides?: Partial<BrainServices>): BrainServices {
  return {
    phantomPool: overrides?.phantomPool ?? new SupabasePhantomPoolProvider(),
    search: overrides?.search ?? new SupabaseSearchProvider(),
    haikuAnalyzer: overrides?.haikuAnalyzer ?? new HaikuAnalyzer(),
    llmAdapter: overrides?.llmAdapter ?? createPrimaryAdapter(),
    onResponse: overrides?.onResponse,
  };
}

// ── Phantom Generator LLM ────────────────────────────────────────────────────

import type { PhantomGeneratorLLM } from '../brain/phantom-generator.js';

export function createPhantomLLM(): PhantomGeneratorLLM {
  return {
    async generateHaiku(opts) {
      const adapter = createPrimaryAdapter();
      const result = await adapter.generateText({
        system: 'You are a creative analyst.',
        prompt: opts.prompt,
        temperature: opts.temperature,
      });
      return result.text;
    },
    async generateSonnet(opts) {
      const adapter = createPrimaryAdapter();
      const result = await adapter.generateText({
        system: 'You are a creative analyst.',
        prompt: opts.prompt,
        temperature: opts.temperature,
      });
      return result.text;
    },
  };
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

export async function shutdownServices(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
