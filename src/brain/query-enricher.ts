/**
 * Query Enricher
 *
 * Builds enriched search queries from conversation context and
 * phantom activation keywords. A richer query produces more
 * contextually relevant retrieval results.
 *
 * Ported from: ~/aiden-colleague/src/lib/rag/query-enricher.ts
 * Full logic preserved.
 */

import type { ConversationExchange, PhantomActivationScored } from '../types.js';

/**
 * Build an enriched search query by combining:
 * 1. Condensed conversation context (last 2 assistant messages)
 * 2. The user's current message
 * 3. Top phantom activation keywords
 *
 * This produces a query embedding that naturally steers toward
 * the conversation's domain and the personality's current focus.
 */
export function buildEnrichedQuery(
  userMessage: string,
  conversationHistory: ConversationExchange[],
  activatedPhantoms: PhantomActivationScored[],
): string {
  const parts: string[] = [];

  // 1. Conversation context: last 2 assistant responses, condensed
  const recentAssistant = conversationHistory
    .slice(-2)
    .map((ex) => ex.aiResponse.slice(0, 200))
    .filter(Boolean);

  if (recentAssistant.length > 0) {
    parts.push(recentAssistant.join(' '));
  }

  // 2. User message (always included, full)
  parts.push(userMessage);

  // 3. Phantom keywords: top 5 activated phantom shorthand/feeling seeds
  const phantomKeywords = activatedPhantoms
    .slice(0, 5)
    .map((p) => p.phantom.feelingSeed)
    .filter(Boolean);

  if (phantomKeywords.length > 0) {
    parts.push(phantomKeywords.join(' '));
  }

  return parts.join(' | ');
}
