/**
 * Phantom Activator
 *
 * Full keyword scoring with conversation dynamics (defense ramps, ideation curves,
 * bold multipliers), anti-phantom suppression, and top-N selection.
 * Handles 3 phantom pools: base, agency, pack (with 0.8x weight discount for packs).
 *
 * Ported from: ~/aiden-colleague/src/lib/ai/phantom-activator.ts
 * Adapted: Removed Next.js imports, uses local type imports.
 *
 * CRITICAL: Every multiplier, curve, and threshold preserved exactly from source.
 */

import type {
  Phantom,
  AgencyPhantom,
  PhantomLike,
  PhantomPackItem,
  PhantomActivationScored,
  ConversationDynamicsLegacy,
  ConversationExchange,
  ResponseMode,
  UserPhantomProxy,
  PhantomPreferences,
} from '../types.js';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const intentPatternsConfig = require('../config/intent-patterns.json') as { intents: Record<string, { triggers: string[] }> };
const emotionalMarkersConfig = require('../config/emotional-markers.json') as { emotions: Record<string, { markers: string[] }>; defaultEmotion: string };

// ── Stop words for keyword filtering ─────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'it', 'in', 'on', 'to', 'for', 'of', 'and',
  'or', 'with', 'that', 'this', 'be', 'as', 'at', 'by', 'from', 'are',
  'was', 'were', 'been', 'has', 'have', 'had', 'do', 'does', 'did',
  'but', 'not', 'no', 'so', 'if', 'they', 'them', 'we', 'you', 'your',
  'our', 'my', 'me', 'he', 'she', 'his', 'her', 'its', 'who', 'what',
  'how', 'can', 'will', 'just', 'more', 'over', 'very', 'about',
]);

// ── Influence category keywords ──────────────────────────────────────────────

const DEFENSE_INFLUENCES = ['DEFEND', 'REJECT', 'PUSH_BACK', 'CHALLENGE_BACK'];
const IDEATION_INFLUENCES = [
  'LEAD_WITH', 'SURPRISE', 'GENERATE', 'CONTRIBUTE',
  'FLIP_', 'HUNT_', 'MINE_', 'ANSWER_VAGUE', 'ADD_ORTHOGONAL',
  'REFRAME', 'EXCAVATE', 'DO_THE_EXACT', 'HIJACK', 'INJECT',
];
const BOLD_INFLUENCES = [
  'BOLD', 'WILD', 'SURPRISE', 'SUBVERT', 'OPPOSITE',
  'BIZARRE', 'UNEXPECTED', 'FEARLESS',
];

// ── Brevity influences ───────────────────────────────────────────────────────

const BREVITY_INFLUENCES = ['BE_ULTRA_BRIEF', 'BE_BRIEF', 'RESPOND_BRIEFLY', 'MATCH_BREVITY'];

// ── Complex message analysis words ───────────────────────────────────────────

const COMPLEX_WORDS = [
  'analyze', 'analysis', 'comprehensive', 'detailed', 'thorough', 'strategy',
  'examine', 'evaluation', 'assessment', 'comparison', 'research', 'study',
  'explain', 'describe', 'elaborate', 'discuss', 'insights', 'implications',
  'effectiveness', 'optimization', 'improvement', 'recommendations', 'approach',
];

const ANALYTICAL_PATTERNS = [
  'how to', 'how do i', 'how can i', 'what is the best way',
  'what are the', 'how does', 'why does', 'what would',
  'can you help me', 'i need to', 'looking for',
];

// ── Mode phantom prefix mappings ─────────────────────────────────────────────

const MODE_PHANTOM_PREFIXES: Record<string, readonly string[]> = {
  spark: ['spark_', 'brief_lightning', 'concise_', 'essence_', 'rapid_'],
  deep: ['deep_', 'systems_', 'evidence_', 'deep_context'],
  build: ['blueprint_', 'execution_', 'process_', 'implementation_'],
  sell: ['conviction_', 'value_', 'urgency_', 'objection_'],
  copy: ['hook_', 'voice_', 'emotion_', 'memory_'],
};

// ── Helper: Get phantom identity text ────────────────────────────────────────

function getIdentityText(phantom: PhantomLike): string {
  return `${phantom.feelingSeed} | ${phantom.phantomStory} | ${phantom.influence}`;
}

// ── Helper: Check if phantom enforces brevity ────────────────────────────────

function isBrevityPhantom(phantom: PhantomLike): boolean {
  return BREVITY_INFLUENCES.some((inf) => phantom.influence.includes(inf));
}

// ── Helper: Analyze message complexity ───────────────────────────────────────

function analyzeMessageComplexityLocal(message: string): 'complex' | 'moderate' | 'simple' {
  const wordCount = message.split(/\s+/).length;
  const messageLower = message.toLowerCase();

  const complexWordCount = COMPLEX_WORDS.filter((w) => messageLower.includes(w)).length;
  const hasAnalyticalPattern = ANALYTICAL_PATTERNS.some((p) => messageLower.includes(p));

  if (wordCount >= 8 || complexWordCount >= 1 || hasAnalyticalPattern) {
    return 'complex';
  } else if (wordCount >= 4) {
    return 'moderate';
  }
  return 'simple';
}

// ── Core keyword scoring ─────────────────────────────────────────────────────

/**
 * Score a phantom against Haiku-generated activation keywords.
 *
 * Checks keyword matches against phantom identity text (feelingSeed,
 * phantomStory, influence). Splits multi-word keywords into individual
 * words for broader matching. Returns a 0.0-1.0 relevance score.
 */
function keywordScore(phantom: PhantomLike, keywords: string[]): number {
  if (!keywords.length) return 0.0;

  const identity = getIdentityText(phantom).toLowerCase();

  // Expand keywords: each keyword becomes its individual words (filtered)
  const matchWords = new Set<string>();
  for (const kw of keywords) {
    for (const w of kw.toLowerCase().split(/\s+/)) {
      if (w.length >= 3 && !STOP_WORDS.has(w)) {
        matchWords.add(w);
      }
    }
  }

  // Count unique word matches against identity text
  let matches = 0;
  for (const w of matchWords) {
    if (identity.includes(w)) {
      matches++;
    }
  }

  // Normalize: 4+ word matches = max score
  return Math.min(matches / 4.0, 1.0);
}

// ── Response mode detection ──────────────────────────────────────────────────

/**
 * Detect which response mode the user is requesting.
 */
export function detectResponseMode(message: string): ResponseMode {
  const lower = message.toLowerCase();

  const sparkTriggers = ['spark', 'brief', 'quick', 'short', 'concise', 'tldr', 'summary'];
  const deepTriggers = ['deep', 'comprehensive', 'analyze', 'thorough', 'detailed'];
  const buildTriggers = ['build', 'implement', 'create', 'step by step', 'how to'];
  const sellTriggers = ['sell', 'convince', 'persuade', 'pitch', 'why should'];
  const copyTriggers = ['copy', 'headline', 'tagline', 'campaign', 'copywriting', 'ad copy'];

  if (sparkTriggers.some((t) => lower.includes(t))) return 'spark';
  if (deepTriggers.some((t) => lower.includes(t))) return 'deep';
  if (buildTriggers.some((t) => lower.includes(t))) return 'build';
  if (sellTriggers.some((t) => lower.includes(t))) return 'sell';
  if (copyTriggers.some((t) => lower.includes(t))) return 'copy';
  return 'default';
}

// ── Conversation dynamics calculator ─────────────────────────────────────────

/**
 * Calculate progressive conversation curve multipliers.
 *
 * Defense phantoms ramp up over time (suppressed early).
 * Ideation phantoms are boosted early and taper off.
 * Bold phantoms emerge in longer conversations.
 *
 * Exchanges 1-3:  defense 0.25x, ideation 1.3x, bold 1.0x
 * Exchanges 4-5:  defense 0.5x,  ideation 1.15x, bold 1.0x
 * Exchanges 6-8:  defense 0.75x, ideation 1.0x,  bold 1.2x
 * Exchanges 9+:   defense 1.0x,  ideation 1.0x,  bold 1.3x
 */
export function calculateConversationDynamics(
  numExchanges: number,
  forceIdeationBoost: boolean = false,
): ConversationDynamicsLegacy {
  let defenseMult: number;
  let ideationMult: number;
  let boldMult: number;

  if (numExchanges <= 3) {
    defenseMult = 0.25;
    ideationMult = 1.3;
    boldMult = 1.0;
  } else if (numExchanges <= 5) {
    defenseMult = 0.5;
    ideationMult = 1.15;
    boldMult = 1.0;
  } else if (numExchanges <= 8) {
    defenseMult = 0.75;
    ideationMult = 1.0;
    boldMult = 1.2;
  } else {
    defenseMult = 1.0;
    ideationMult = 1.0;
    boldMult = 1.3;
  }

  // Force ideation boost on creative reset (kill detection)
  if (forceIdeationBoost) {
    ideationMult = Math.max(ideationMult, 1.3);
  }

  return { defenseMult, ideationMult, boldMult, numExchanges };
}

// ── Main evaluation ──────────────────────────────────────────────────────────

export interface EvaluatePhantomOptions {
  message: string;
  conversationHistory: ConversationExchange[];
  activationKeywords?: string[];
  isEscalation?: boolean;
  suppressedKeys?: string[];
  forceIdeationBoost?: boolean;
}

/**
 * Evaluate which phantoms should activate from the base pool.
 *
 * Uses Haiku-generated activation keywords for semantic matching.
 * Applies conversation dynamics (defense/ideation/bold curves),
 * brevity suppression, mode boosts, escalation boosts, and
 * creative reset suppression.
 */
export function evaluatePhantoms(
  phantoms: Map<string, Phantom>,
  options: EvaluatePhantomOptions,
): { activations: PhantomActivationScored[]; dynamics: ConversationDynamicsLegacy } {
  const {
    message,
    conversationHistory,
    isEscalation = false,
    suppressedKeys = [],
    forceIdeationBoost = false,
  } = options;

  let { activationKeywords } = options;

  const detectedMode = detectResponseMode(message);
  const modeBoost = detectedMode === 'spark' ? 2.0 : 1.0;

  let useKeywords = Boolean(activationKeywords?.length);

  if (!useKeywords) {
    // Fallback: extract keywords from user message when Haiku fails/times out
    const fallbackWords = message
      .split(/\s+/)
      .map((w) => w.toLowerCase().replace(/[.,!?;:'"\-()[\]]/g, ''))
      .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));

    if (fallbackWords.length > 0) {
      activationKeywords = fallbackWords.slice(0, 15);
      useKeywords = true;
      console.log(
        `[PhantomActivator] Using ${activationKeywords.length} fallback keywords from message`,
      );
    } else {
      console.log('[PhantomActivator] No keywords available, zero scores');
    }
  } else {
    console.log(
      `[PhantomActivator] Using Haiku keywords (${activationKeywords!.length} keywords)`,
    );
  }

  // Progressive conversation curve
  const numExchanges = conversationHistory.length;
  const dynamics = calculateConversationDynamics(numExchanges, forceIdeationBoost);
  const { defenseMult, ideationMult, boldMult } = dynamics;

  const intents = detectIntents(message);
  const emotion = detectEmotion(message);
  const conversationContext = numExchanges <= 2 ? 'opening' : numExchanges <= 5 ? 'building' : 'deep';

  const suppressedSet = new Set(suppressedKeys);
  const activations: PhantomActivationScored[] = [];

  for (const [phantomKey, phantom] of phantoms) {
    // Base score: Haiku keywords matched against phantom identity text (broad, semantic)
    let activationScore = 0.0;
    if (useKeywords && activationKeywords) {
      const relevance = keywordScore(phantom, activationKeywords);
      activationScore = relevance * phantom.weight;
    }

    // Layer 2-4 boosts: intent, emotion, conversation context (from 6-layer system)
    if (phantom.intentTriggers) {
      for (const intent of phantom.intentTriggers) {
        if (intents[intent]) {
          activationScore += 3.5;
        }
      }
    }
    if (activationScore > 0 && phantom.emotionalContexts?.includes(emotion)) {
      activationScore *= 1.4;
    }
    if (activationScore > 0 && phantom.conversationContexts?.includes(conversationContext)) {
      activationScore *= 1.2;
    }

    // Brevity suppression on complex queries (0.1x)
    if (isBrevityPhantom(phantom) && analyzeMessageComplexityLocal(message) === 'complex') {
      activationScore *= 0.1;
    }

    // Mode boost for matching phantoms (spark mode = 2x)
    const prefixes = MODE_PHANTOM_PREFIXES[detectedMode];
    if (prefixes) {
      if (prefixes.some((prefix) => phantomKey.startsWith(prefix))) {
        activationScore *= modeBoost;
      }
    }

    // Progressive conversation curve: graduated multipliers
    if (activationScore > 0) {
      const influence = phantom.influence?.toUpperCase() ?? '';

      if (DEFENSE_INFLUENCES.some((d) => influence.includes(d))) {
        activationScore *= defenseMult;
      } else if (IDEATION_INFLUENCES.some((i) => influence.includes(i))) {
        activationScore *= ideationMult;
      }

      // Bold phantom boost (late conversation + escalation)
      if (BOLD_INFLUENCES.some((b) => influence.includes(b))) {
        if (boldMult > 1.0) {
          activationScore *= boldMult;
        }
        // Escalation: extra 1.5x boost for bold phantoms
        if (isEscalation) {
          activationScore *= 1.5;
        }
      }
    }

    // Creative reset: suppress previously-dominant phantoms (0.3x)
    if (suppressedSet.has(phantomKey) && activationScore > 0) {
      activationScore *= 0.3;
    }

    activations.push({
      key: phantomKey,
      phantom,
      score: activationScore,
      source: 'base',
    });
  }

  // Sort by score descending
  activations.sort((a, b) => b.score - a.score);

  const activeCount = activations.filter((a) => a.score > 0).length;
  console.log(
    `[PhantomActivator] Total=${activations.length}, Active=${activeCount}, ` +
      `Exchanges=${numExchanges}, DefMult=${defenseMult}, IdeaMult=${ideationMult}, ` +
      `BoldMult=${boldMult}, Escalation=${isEscalation}, Suppressed=${suppressedSet.size}`,
  );

  return { activations, dynamics };
}

// ── Agency + Pack phantom evaluation ─────────────────────────────────────────

/**
 * Evaluate agency and pack phantoms.
 * Agency phantoms score at full weight; pack phantoms get 0.8x discount.
 */
export function evaluateAgencyPhantoms(
  agencyPhantoms: AgencyPhantom[],
  packPhantoms: PhantomPackItem[],
  activationKeywords: string[],
  _dynamics: ConversationDynamicsLegacy,
  message: string,
  numExchanges: number,
): PhantomActivationScored[] {
  const intents = detectIntents(message);
  const emotion = detectEmotion(message);
  const conversationContext = numExchanges <= 2 ? 'opening' : numExchanges <= 5 ? 'building' : 'deep';

  const activations: PhantomActivationScored[] = [];

  // Score agency phantoms at full weight
  for (const phantom of agencyPhantoms) {
    const score = scorePhantomSixLayer({
      phantom: {
        shorthand: phantom.shorthand,
        weight: phantom.weight,
        wordTriggers: phantom.wordTriggers ?? [],
        intentTriggers: (phantom as any).intentTriggers,
        emotionalContexts: (phantom as any).emotionalContexts,
        conversationContexts: (phantom as any).conversationContexts,
        influence: phantom.influence,
        identityText: phantom.identityText ?? '',
        feelingSeed: phantom.feelingSeed,
        phantomStory: phantom.phantomStory,
      },
      messageLower: message.toLowerCase(),
      intents,
      emotion,
      conversationContext,
    });

    activations.push({
      key: `agency_${phantom.shorthand}`,
      phantom,
      score,
      source: 'agency',
    });
  }

  // Score pack phantoms with 0.8x weight discount
  for (const phantom of packPhantoms) {
    const score = scorePhantomSixLayer({
      phantom: {
        shorthand: phantom.shorthand,
        weight: phantom.weight,
        wordTriggers: phantom.wordTriggers ?? [],
        intentTriggers: (phantom as any).intentTriggers,
        emotionalContexts: (phantom as any).emotionalContexts,
        conversationContexts: (phantom as any).conversationContexts,
        influence: phantom.influence,
        identityText: phantom.identityText ?? '',
        feelingSeed: phantom.feelingSeed,
        phantomStory: phantom.phantomStory,
      },
      messageLower: message.toLowerCase(),
      intents,
      emotion,
      conversationContext,
    }) * 0.8;

    activations.push({
      key: `pack_${phantom.shorthand}`,
      phantom,
      score,
      source: 'pack',
    });
  }

  activations.sort((a, b) => b.score - a.score);
  return activations;
}

// ── User phantom merging ─────────────────────────────────────────────────────

const USER_PHANTOM_FAMILIARITY_BOOST = 1.2;

/**
 * Score identity text against activation keywords.
 */
function keywordScoreText(identityText: string, keywords: string[]): number {
  if (!keywords.length) return 0.0;

  const identity = identityText.toLowerCase();
  const matchWords = new Set<string>();
  for (const kw of keywords) {
    for (const w of kw.toLowerCase().split(/\s+/)) {
      if (w.length >= 3 && !STOP_WORDS.has(w)) {
        matchWords.add(w);
      }
    }
  }

  let matches = 0;
  for (const w of matchWords) {
    if (identity.includes(w)) matches++;
  }
  return Math.min(matches / 4.0, 1.0);
}

/**
 * Create a UserPhantomProxy from a raw user phantom dict.
 */
export function createUserPhantomProxy(data: Record<string, unknown>): UserPhantomProxy {
  const feelingSeed = String(data.feeling_seed ?? data.feelingSeed ?? '');
  const phantomStory = String(data.phantom_story ?? data.phantomStory ?? '');
  const influence = String(data.influence ?? '');

  return {
    shorthand: String(data.shorthand ?? 'user_phantom'),
    weight: Number(data.weight ?? 3.0),
    influence,
    feelingSeed,
    phantomStory,
    originContext: `Born from conversation: ${String(data.born_from_conversation_id ?? data.bornFromConversationId ?? 'unknown')}`,
    activationCount: Number(data.activation_count ?? data.activationCount ?? 0),
    identityText: `${feelingSeed} | ${phantomStory} | ${influence}`,
    userPhantomId: String(data.id ?? ''),
    isAntiPhantom: Boolean(data.is_anti_phantom ?? data.isAntiPhantom ?? false),
  };
}

/**
 * Merge user phantom layer with base phantom activations.
 *
 * Keyword-based merge (no embeddings required):
 * - Score each user phantom's identity text against activation keywords
 * - Apply 1.2x familiarity boost
 * - Anti-phantoms penalize similar base phantoms
 * - Return merged + sorted list
 */
export function mergeUserPhantoms(
  userPhantoms: Record<string, unknown>[],
  activationKeywords: string[],
  baseActivated: PhantomActivationScored[],
): PhantomActivationScored[] {
  if (!userPhantoms.length) return baseActivated;

  // Separate regular from anti-phantoms
  const regular = userPhantoms.filter((p) => !p.is_anti_phantom && !p.isAntiPhantom);
  const antis = userPhantoms.filter((p) => p.is_anti_phantom || p.isAntiPhantom);

  // Start with base activated (mutable copy)
  const merged: PhantomActivationScored[] = [...baseActivated];

  // Score and add regular user phantoms
  for (const phantomData of regular) {
    const proxy = createUserPhantomProxy(phantomData);
    const kScore = keywordScoreText(proxy.identityText, activationKeywords);
    const finalScore = kScore * proxy.weight * USER_PHANTOM_FAMILIARITY_BOOST;

    if (finalScore > 0) {
      merged.push({
        key: `user_${String(phantomData.id ?? 'unknown').slice(0, 8)}`,
        phantom: proxy,
        score: finalScore,
        source: 'user',
      });
    }
  }

  // Apply anti-phantom penalties to similar base phantoms
  const antiKeywordsExpanded = new Set<string>();
  for (const kw of activationKeywords) {
    for (const w of kw.toLowerCase().split(/\s+/)) {
      if (w.length >= 3 && !STOP_WORDS.has(w)) {
        antiKeywordsExpanded.add(w);
      }
    }
  }

  for (const anti of antis) {
    const antiProxy = createUserPhantomProxy(anti);
    const antiRelevance = keywordScoreText(antiProxy.identityText, activationKeywords);
    if (antiRelevance < 0.2) continue; // Anti-phantom not relevant to this context

    // Penalize base phantoms with similar identity text
    for (const activation of merged) {
      if (activation.source !== 'base') continue;

      const phantomIdentity = getIdentityText(activation.phantom).toLowerCase();
      let overlap = 0;
      for (const w of antiKeywordsExpanded) {
        if (phantomIdentity.includes(w)) overlap++;
      }

      if (overlap >= 2) {
        const penalty = (Number(anti.weight) || 3.0) * 0.15;
        activation.score = Math.max(0.0, activation.score - penalty);
      }
    }
  }

  // Sort by score descending
  merged.sort((a, b) => b.score - a.score);
  return merged;
}

// ── Select top-N phantoms ────────────────────────────────────────────────────

/**
 * Select top-N phantoms from merged activations.
 * Filters out zero-score phantoms.
 */
export function selectTopPhantoms(
  activations: PhantomActivationScored[],
  maxPhantoms: number = 12,
): PhantomActivationScored[] {
  return activations.filter((a) => a.score > 0).slice(0, maxPhantoms);
}

// ── Workspace phantom preferences ───────────────────────────────────────────

/**
 * Apply workspace-level phantom boost/suppress preferences.
 */
export function applyWorkspacePreferences(
  activations: PhantomActivationScored[],
  preferences: PhantomPreferences,
): PhantomActivationScored[] {
  const boostMap = new Map(preferences.boost.map((b) => [b.phantomShorthand, b.multiplier]));
  const suppressMap = new Map(preferences.suppress.map((s) => [s.phantomShorthand, s.multiplier]));

  return activations.map((a) => {
    const boost = boostMap.get(a.phantom.shorthand);
    const suppress = suppressMap.get(a.phantom.shorthand);
    if (boost) return { ...a, score: a.score * boost };
    if (suppress) return { ...a, score: a.score * suppress };
    return a;
  });
}

// ── 6-Layer Phantom Activation Scoring ───────────────────────────────────────

/**
 * Input shape for 6-layer phantom scoring.
 */
export interface SixLayerInput {
  phantom: {
    shorthand: string;
    weight: number;
    wordTriggers: string[];
    intentTriggers?: string[];
    emotionalContexts?: string[];
    conversationContexts?: string[];
    influence: string;
    identityText: string;
    feelingSeed: string;
    phantomStory: string;
  };
  messageLower: string;
  intents: Record<string, boolean>;
  emotion: string;
  conversationContext: string;
}

/**
 * Detect which intents are active in a message.
 *
 * Matches each intent's trigger phrases against the lowercased message.
 * Returns a flat map of intentName -> boolean.
 */
export function detectIntents(message: string): Record<string, boolean> {
  const lower = message.toLowerCase();
  const result: Record<string, boolean> = {};

  const intents = intentPatternsConfig.intents as Record<string, { triggers: string[] }>;
  for (const [intentName, intentDef] of Object.entries(intents)) {
    result[intentName] = intentDef.triggers.some((trigger: string) => lower.includes(trigger));
  }

  return result;
}

/**
 * Detect the dominant emotion from a message.
 *
 * Iterates emotion definitions in declaration order and returns the first
 * emotion whose markers appear in the lowercased message.
 * Falls back to the configured defaultEmotion ("neutral").
 */
export function detectEmotion(message: string): string {
  const lower = message.toLowerCase();

  const emotions = emotionalMarkersConfig.emotions as Record<string, { markers: string[] }>;
  for (const [emotionName, emotionDef] of Object.entries(emotions)) {
    if (emotionDef.markers.some((marker: string) => lower.includes(marker.toLowerCase()))) {
      return emotionName;
    }
  }

  return emotionalMarkersConfig.defaultEmotion;
}

/**
 * Score a single phantom using the 6-layer algorithm.
 *
 * Layer 1: Direct word triggers. Each matching trigger adds +2.0.
 * Layer 2: Intent pattern matching. Each active intent trigger adds +3.5.
 * Layer 3: Emotional context. Matching emotion multiplies score by 1.4.
 * Layer 4: Conversational context. Matching context multiplies score by 1.2.
 * Layers 5 & 6: Semantic/embedding-based (deferred to future work).
 * Final: multiply by (phantom.weight / 3.0).
 */
export function scorePhantomSixLayer(input: SixLayerInput): number {
  const { phantom, messageLower, intents, emotion, conversationContext } = input;

  let score = 0;

  // Layer 1: Direct word triggers (+2.0 each)
  for (const trigger of phantom.wordTriggers) {
    if (messageLower.includes(trigger)) {
      score += 2.0;
    }
  }

  // Layer 2: Intent pattern matching (+3.5 each)
  for (const intentTrigger of phantom.intentTriggers ?? []) {
    if (intents[intentTrigger] === true) {
      score += 3.5;
    }
  }

  // Short-circuit: no score from layers 1-2, layers 3-4 have nothing to multiply
  if (score === 0) {
    return 0;
  }

  // Layer 3: Emotional context (x1.4 if matching)
  if (phantom.emotionalContexts?.includes(emotion)) {
    score *= 1.4;
  }

  // Layer 4: Conversational context (x1.2 if matching)
  if (phantom.conversationContexts?.includes(conversationContext)) {
    score *= 1.2;
  }

  // Final: weight divisor
  score *= phantom.weight / 3.0;

  return score;
}
