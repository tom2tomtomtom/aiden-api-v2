/**
 * Creative Knowledge Service
 *
 * Tag-based campaign retrieval keyed to phantom activations.
 * When phantoms fire, their linked campaigns come along for free.
 * O(1) dictionary lookup via inverted index. Zero API cost.
 *
 * Campaigns data is loaded from data/campaigns.json (119 campaigns).
 *
 * Ported from: ~/aiden-unified/backend/aiden/core/creative_knowledge.py (245 lines)
 * + ~/aiden-colleague/src/lib/ai/creative-knowledge.ts
 * Full logic preserved including era diversity and advertising context detection.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ── Types ───────────────────────────────────────────────────────────────────

export interface CampaignEntry {
  id: string;
  campaign_name: string;
  brand: string;
  agency: string;
  year: number;
  category: string;
  verticals: string[];
  tags: string[];
  era: string;
  insight: string;
  execution_summary: string;
  why_it_worked: string;
  creative_principle: string;
  contrarian_element: string;
  phantom_tags: string[];
  strategic_tags: string[];
}

// ── Module-level cache ──────────────────────────────────────────────────────

let campaigns: CampaignEntry[] | null = null;
let invertedIndex: Map<string, number[]> | null = null;
let strategicIndex: Map<string, number[]> | null = null;

// ── Advertising keywords (expanded from Python source) ──────────────────────

const ADVERTISING_KEYWORDS = [
  'campaign', 'brief', 'creative', 'brand', 'advertising',
  ' ad ', 'ads ', 'advert', 'commercial',
  'tagline', 'headline', 'strategy', 'positioning',
  'target audience', 'media plan', ' copy', 'copywriting',
  'strapline', 'manifesto', 'pitch',
  'launch', 'rebrand', 'slogan', 'spot ',
  'billboard', 'print ad', 'tv spot', 'radio spot', 'ooh',
  'social media campaign', 'influencer', 'media buy',
  'creative strategy', 'marketing campaign',
  'sell ', 'selling', 'client presentation',
  'awareness',
];

// ── Index builder ───────────────────────────────────────────────────────────

function buildIndex(): void {
  if (campaigns !== null && invertedIndex !== null) return;

  try {
    const campaignsData = require('../../data/campaigns.json');
    campaigns = campaignsData as CampaignEntry[];
  } catch {
    console.warn('[CreativeKnowledge] Campaign data file not found');
    campaigns = [];
    invertedIndex = new Map();
    strategicIndex = new Map();
    return;
  }

  invertedIndex = new Map<string, number[]>();
  strategicIndex = new Map<string, number[]>();

  for (let i = 0; i < campaigns.length; i++) {
    const entry = campaigns[i];

    // Phantom tag index
    for (const tag of entry.phantom_tags) {
      const existing = invertedIndex.get(tag);
      if (existing) {
        existing.push(i);
      } else {
        invertedIndex.set(tag, [i]);
      }
    }

    // Strategic tag index
    for (const tag of entry.strategic_tags) {
      const existing = strategicIndex.get(tag);
      if (existing) {
        existing.push(i);
      } else {
        strategicIndex.set(tag, [i]);
      }
    }
  }

  console.log(
    `[CreativeKnowledge] Loaded: ${campaigns.length} campaigns, ` +
    `${invertedIndex.size} phantom tags indexed`,
  );
}

// ── Exports ─────────────────────────────────────────────────────────────────

/**
 * Returns true if the message appears to be about advertising or creative work.
 */
export function isAdvertisingContext(message: string): boolean {
  const lower = message.toLowerCase();
  return ADVERTISING_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Returns the top matching campaigns for the given phantom keys, scored by
 * how strongly they align with the active phantoms.
 *
 * Deduplicates by brand (max 1 campaign per brand).
 * Soft era diversity: max 2 from same era.
 */
export function getCampaignsForPhantoms(
  phantomKeys: string[],
  scores: Map<string, number>,
  max = 3,
): CampaignEntry[] {
  buildIndex();

  // Guard for type safety
  if (!campaigns || !invertedIndex) return [];

  const campaignScores = new Map<number, number>();

  for (const key of phantomKeys) {
    const indices = invertedIndex.get(key);
    if (!indices) continue;

    const phantomScore = scores.get(key) ?? 1;
    for (const idx of indices) {
      campaignScores.set(idx, (campaignScores.get(idx) ?? 0) + phantomScore);
    }
  }

  // Sort by score descending
  const sorted = Array.from(campaignScores.entries()).sort((a, b) => b[1] - a[1]);

  // Deduplicate by brand, soft era diversity
  const seenBrands = new Set<string>();
  const results: CampaignEntry[] = [];

  for (const [idx] of sorted) {
    if (results.length >= max) break;
    const entry = campaigns[idx];

    // Skip if we already have this brand
    if (seenBrands.has(entry.brand.toLowerCase())) continue;

    // Soft era diversity: max 2 from same era
    const eraCount = results.filter((c) => c.era === entry.era).length;
    if (eraCount >= 2) continue;

    seenBrands.add(entry.brand.toLowerCase());
    results.push(entry);
  }

  return results;
}

/**
 * Formats campaign entries into a context block for injection into the brain prompt.
 * Only injects when the conversation is actually about advertising.
 */
export function formatCampaignContext(entries: CampaignEntry[], userMessage?: string): string {
  if (entries.length === 0) return '';

  // Only inject campaigns when the conversation is about advertising
  if (userMessage && !isAdvertisingContext(userMessage)) {
    return '';
  }

  const lines: string[] = [
    'CREATIVE REFERENCE LIBRARY (relevant campaign precedents):',
    '',
  ];

  for (const entry of entries) {
    const yearStr = entry.year ? ` (${entry.year})` : '';
    lines.push(`[${entry.brand.toUpperCase()} - "${entry.campaign_name}"${yearStr}]`);
    lines.push(`Principle: ${entry.creative_principle}`);
    lines.push(`Why it worked: ${entry.why_it_worked}`);
    if (entry.contrarian_element) {
      lines.push(`Broke: ${entry.contrarian_element}`);
    }
    lines.push('');
  }

  lines.push(
    'Weave references naturally. Do not list them. ' +
    'Only cite specific campaigns when they directly illuminate the user\'s challenge.',
  );

  return lines.join('\n');
}

/**
 * Get the total number of loaded campaigns.
 */
export function getCampaignCount(): number {
  buildIndex();
  return campaigns?.length ?? 0;
}

/**
 * Check if the creative knowledge service is available.
 */
export function isAvailable(): boolean {
  buildIndex();
  return (campaigns?.length ?? 0) > 0;
}
