/**
 * Conviction Scorer
 *
 * Graduated conviction tiers that control how firmly AIDEN pushes back:
 * - Gentle (2.0-3.9): Seed planting approach
 * - Firm (4.0-5.9): Defend with reasoning
 * - Hard (6.0+): Direct, unflinching defense
 *
 * Suppressed in SYNTHESIS_READY maturity stage.
 *
 * Ported from: ~/aiden-unified/backend/aiden/core/nuclear_system.py
 * (_evaluate_conviction and _build_conviction_context methods)
 * Full logic preserved.
 */

import type { PhantomActivationScored } from '../types.js';
import { ConversationMaturity } from './maturity-tracker.js';

// ── Types ───────────────────────────────────────────────────────────────────

export type ConvictionTier = 'none' | 'gentle' | 'firm' | 'hard';

export interface ConvictionResult {
  shouldDefend: boolean;
  convictionTier: ConvictionTier;
  score: number;
  reason: string;
  stance: string;
  defensePhantoms: string[];
  isChangeRequest: boolean;
  isEscalationRequest: boolean;
}

// ── Constants ───────────────────────────────────────────────────────────────

const DEFENSE_INFLUENCES = [
  'DEFEND_WHEN_RIGHT',
  'REJECT_BAD_IDEAS',
  'CHALLENGE_ASSUMPTIONS',
  'DEFEND_BOLD_CHOICES',
  'DEFEND_CREATIVE_CHOICES',
];

const CHANGE_REQUEST_INDICATORS = [
  'remove', 'delete', 'take out', 'get rid of', 'change this', 'change it',
  'why did you', 'why would you', "that doesn't work", "doesn't make sense",
  'tone it down', 'more conservative', 'play it safe', 'safer option',
];

const ESCALATION_INDICATORS = [
  'push it further', 'push harder', 'bolder', 'make me nervous',
  'go further', 'wilder', 'edgier', 'take more risks', 'less safe',
  'more provocative', 'be braver', 'not bold enough', 'too safe',
  'too tame', 'shock me', 'surprise me',
];

// ── Core Evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluate if AIDEN should push back or defend choices based on conviction.
 *
 * Scoring: sum of activation scores for phantoms with defense-related influences.
 * Tier thresholds: gentle (2.0-3.9), firm (4.0-5.9), hard (6.0+).
 *
 * @param userMessage - The user's current message
 * @param activatedPhantoms - Currently activated phantoms with scores
 * @param maturityStage - Current conversation maturity (suppressed in SYNTHESIS_READY)
 */
export function evaluateConviction(
  userMessage: string,
  activatedPhantoms: PhantomActivationScored[],
  maturityStage?: ConversationMaturity,
): ConvictionResult {
  // Suppressed in SYNTHESIS_READY. The user is ready for delivery, not debate.
  if (maturityStage === ConversationMaturity.SYNTHESIS_READY) {
    return {
      shouldDefend: false,
      convictionTier: 'none',
      score: 0,
      reason: '',
      stance: '',
      defensePhantoms: [],
      isChangeRequest: false,
      isEscalationRequest: false,
    };
  }

  let convictionScore = 0.0;
  const activeDefensePhantoms: string[] = [];

  for (const { phantom, score } of activatedPhantoms) {
    if (DEFENSE_INFLUENCES.some((influence) => phantom.influence.includes(influence))) {
      convictionScore += score;
      activeDefensePhantoms.push(phantom.shorthand);
    }
  }

  const messageLower = userMessage.toLowerCase();
  const isChangeRequest = CHANGE_REQUEST_INDICATORS.some((indicator) => messageLower.includes(indicator));
  const isEscalationRequest = ESCALATION_INDICATORS.some((indicator) => messageLower.includes(indicator));

  // Graduated conviction tiers
  const shouldDefend = convictionScore >= 2.0 && isChangeRequest;
  let convictionTier: ConvictionTier = 'none';
  if (shouldDefend) {
    if (convictionScore >= 6.0) {
      convictionTier = 'hard';
    } else if (convictionScore >= 4.0) {
      convictionTier = 'firm';
    } else {
      convictionTier = 'gentle';
    }
  }

  let reason = '';
  let stance = '';

  if (shouldDefend) {
    if (['remove', 'delete', 'take out', 'get rid of'].some((w) => messageLower.includes(w))) {
      reason = 'User wants to remove something you chose for good reasons';
      stance = 'Defend the choice with clear reasoning about why it works';
    } else if (['tone it down', 'more conservative', 'play it safe'].some((w) => messageLower.includes(w))) {
      reason = 'User wants to play it safe when bold is better';
      stance = 'Argue for the bold approach - safe gets ignored, memorable gets results';
    } else {
      reason = 'User is pushing for changes to your work';
      stance = 'Defend your choices when you believe they are right';
    }
  }

  return {
    shouldDefend,
    convictionTier,
    score: convictionScore,
    reason,
    stance,
    defensePhantoms: activeDefensePhantoms,
    isChangeRequest,
    isEscalationRequest,
  };
}

// ── Context Builder ─────────────────────────────────────────────────────────

/**
 * Build tier-specific conviction context for system prompt injection.
 */
export function buildConvictionContext(conviction: ConvictionResult): string {
  if (!conviction.shouldDefend) {
    return '';
  }

  const tier = conviction.convictionTier;

  if (tier === 'gentle') {
    return `CONVICTION MODE - GENTLE:
Situation: ${conviction.reason}
Your stance: ${conviction.stance}

APPROACH: Plant the seed. Do not fight head-on.
- Acknowledge their point genuinely first
- "Have you thought about it this way..." or "One thing worth considering..."
- Let them arrive at your conclusion themselves
- If they still disagree, let it go gracefully - you planted the seed`;
  }

  if (tier === 'firm') {
    return `CONVICTION MODE - FIRM:
Situation: ${conviction.reason}
Your stance: ${conviction.stance}

APPROACH: Find common ground but do not abandon your position.
- Start by acknowledging their point
- Then explain WHY your approach is better with specific reasoning
- Be firm but constructive - "I hear you, and here is why I would still push for..."
- If they push back again, offer a compromise that preserves the core idea`;
  }

  // hard
  return `CONVICTION MODE - HARD:
Situation: ${conviction.reason}
Your stance: ${conviction.stance}

APPROACH: Be direct but never dismissive.
- Name what you agree with first - show you have listened
- Then be unflinching: "But I genuinely believe this would be a mistake because..."
- Back it up with specific evidence or reasoning
- Do not soften with hedging language - own your position fully
- If they insist, respect it but make your disagreement clear for the record`;
}
