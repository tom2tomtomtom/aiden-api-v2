/**
 * Seed the canonical system_phantoms library from data/phantoms.json.
 * Idempotent: upserts on phantom_key. Run once per DB, or again after
 * data/phantoms.json changes to ship updates to every licensee.
 *
 *   npx tsx scripts/seed-system-phantoms.ts
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

interface PhantomSeed {
  phantom_key?: string;
  shorthand: string;
  feeling_seed: string;
  phantom_story: string;
  influence: string;
  word_triggers?: string[];
  intent_triggers?: string[];
  emotional_contexts?: string[];
  conversation_contexts?: string[];
  origin_context?: string;
  weight?: number;
}

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_KEY!;
if (!url || !serviceKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  process.exit(1);
}

const db = createClient(url, serviceKey);

const phantoms: PhantomSeed[] = JSON.parse(readFileSync('data/phantoms.json', 'utf8'));
const rows = phantoms.map((p) => ({
  phantom_key: p.phantom_key ?? p.shorthand,
  shorthand: p.shorthand,
  feeling_seed: p.feeling_seed,
  phantom_story: p.phantom_story,
  influence: p.influence,
  word_triggers: p.word_triggers ?? [],
  intent_triggers: p.intent_triggers ?? [],
  emotional_contexts: p.emotional_contexts ?? [],
  conversation_contexts: p.conversation_contexts ?? [],
  origin_context: p.origin_context ?? null,
  weight: p.weight ?? 3.0,
  is_active: true,
}));

console.log(`Upserting ${rows.length} system phantoms...`);

const CHUNK = 100;
let done = 0;
for (let i = 0; i < rows.length; i += CHUNK) {
  const batch = rows.slice(i, i + CHUNK);
  const { error } = await db.from('system_phantoms').upsert(batch, { onConflict: 'phantom_key' });
  if (error) {
    console.error(`Batch ${i / CHUNK + 1} failed:`, error.message);
    process.exit(1);
  }
  done += batch.length;
  console.log(`  ...${done}/${rows.length}`);
}

const { count } = await db
  .from('system_phantoms')
  .select('*', { count: 'exact', head: true });

console.log(`Done. system_phantoms now has ${count} rows.`);
