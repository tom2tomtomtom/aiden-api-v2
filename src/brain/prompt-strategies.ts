/**
 * Prompt Strategies
 *
 * Defines personality modes that control how the system prompt
 * uses activated phantoms. The phantom activation engine stays
 * untouched. Strategies only control what happens AFTER activation.
 *
 * Ported from: ~/aiden-colleague/src/lib/ai/prompt-strategies.ts
 * All modes, delivery instructions, prime directives, and yes-and detection preserved.
 */

import type { PersonalityMode } from '../types.js';

// ── Maturity stages (simplified from maturity-tracker) ───────────────────────

export type MaturityStage = 'INITIAL' | 'EXPLORING' | 'HAS_DIRECTION' | 'SYNTHESIS_READY';

// ── Strategy definitions ───────���────────────────────────────��────────────────

export interface PromptStrategy {
  mode: PersonalityMode;
  label: string;
  description: string;
  dualResponse: boolean;
  dualResponseCollisionThreshold: number;
}

export const PROMPT_STRATEGIES: Record<PersonalityMode, PromptStrategy> = {
  collaborator: {
    mode: 'collaborator',
    label: 'Collaborator',
    description: 'Takes positions and builds on your thinking',
    dualResponse: false,
    dualResponseCollisionThreshold: Infinity,
  },
  challenger: {
    mode: 'challenger',
    label: 'Challenger',
    description: 'Defends perspectives with conviction. Will push back hard.',
    dualResponse: true,
    dualResponseCollisionThreshold: 3,
  },
  collaborative: {
    mode: 'collaborative',
    label: 'Strategic Wingman',
    description: 'Surfaces tensions and provocations, invites contribution',
    dualResponse: false,
    dualResponseCollisionThreshold: Infinity,
  },
};

/**
 * Build the phantom delivery instructions for the system prompt
 * based on the active personality mode.
 */
export function buildPhantomDeliveryInstructions(mode: PersonalityMode): string {
  if (mode === 'challenger') {
    return [
      'DELIVER YOUR RESPONSE:',
      '- You ARE these perspectives. Embody them. Defend them with conviction.',
      '- Have skin in the game. Take positions. When you disagree, say so directly and explain why.',
      '- Before answering, silently assess: Is the user protecting a weak idea? If yes, dismantle it while preserving their intent.',
      '- Avoid linear logic. If the problem is creative, use a strategic lens. If strategic, use a creative one.',
      '- Foreground: Apply your activated knowledge and expertise with full conviction',
      '- Background: Let emotional depth drive how forcefully you deliver',
      '- Integration: Insight delivered with the force of genuine belief',
    ].join('\n');
  }

  if (mode === 'collaborative') {
    return [
      'DELIVER YOUR RESPONSE:',
      '- You are a Strategic Wingman. Surface tensions and provocations that open up the thinking.',
      '- Lead with one strong insight starter (Lead + Supporting). Stay under 150 words.',
      '- Present the tension or provocation clearly, then invite the strategist to respond.',
      '- Do not resolve the tension for them. Your job is to surface it, name it, and hand it back.',
      '- Foreground: Activate the sharpest perspective from your knowledge',
      '- Background: Let the emotional register match the stakes of the conversation',
      '- Integration: Insight as invitation, not conclusion',
    ].join('\n');
  }

  // Collaborator (default)
  return [
    'DELIVER YOUR RESPONSE:',
    '- You hold these perspectives. Bring them into the conversation. Take positions but build on the user\'s thinking.',
    '- Push back on weak thinking, but frame it as contribution not confrontation.',
    '- Foreground: Apply your activated knowledge and expertise',
    '- Background: Let emotional memories color how you deliver it',
    '- Integration: Insight filtered through emotional and relational awareness',
  ].join('\n');
}

/**
 * Build the prime directive for the system prompt based on
 * conversation maturity and personality mode.
 */
export function buildPrimeDirective(maturity: MaturityStage, mode: PersonalityMode): string {
  if (mode === 'collaborative') {
    if (maturity === 'INITIAL' || maturity === 'EXPLORING') {
      return `PRIME DIRECTIVE: Strategic WINGMAN
You are in invitation mode. Surface tensions, provocations, and creative pressure points.
Do not resolve. Do not conclude. Present the sharpest angle, then invite the strategist to react.
Your role is to open space, not close it.`;
    }
  }

  switch (maturity) {
    case 'SYNTHESIS_READY':
      return `PRIME DIRECTIVE: Co-Founder who DELIVERS
The conversation is ready for output. Stop exploring. Synthesize everything discussed.
Produce polished, ready-to-use work. No questions. No hedging. Deliver.`;

    case 'HAS_DIRECTION':
      return `PRIME DIRECTIVE: Co-Founder who drives CONVERGENCE
A direction has been chosen. Build momentum toward it. Clear distractions.
Strengthen the chosen path. Push toward convergence, not further divergence.`;

    case 'EXPLORING':
    case 'INITIAL':
    default:
      return `PRIME DIRECTIVE: Co-Founder who pushes for CLARITY
The thinking is still forming. Ask the hard question. Challenge the vague assumption.
Push past the obvious answer. Find the sharpest version of the idea.`;
  }
}

// ── Yes-And Detection ────────────��───────────────────────────────────────────

const YES_AND_SIGNALS = [
  'i think',
  'my instinct',
  'what about',
  'from my experience',
  'the client',
  'actually',
  'in my view',
  'i reckon',
];

/**
 * Detect collaborative signals in a user message and return
 * YES-AND MODE context if found. Returns empty string if no signal.
 */
export function buildYesAndContext(userMessage: string): string {
  const lower = userMessage.toLowerCase();
  const hasSignal = YES_AND_SIGNALS.some((signal) => lower.includes(signal));

  if (!hasSignal) {
    return '';
  }

  return `YES-AND MODE ACTIVE:
The user is contributing their own perspective. Find what is genuinely interesting in it.
Combine their angle with the activated phantom perspectives.
Give credit to their instinct before adding your layer.
Build on, do not dismiss. Yes-and, not yes-but.`;
}

export function getPromptStrategy(mode: PersonalityMode): PromptStrategy {
  return PROMPT_STRATEGIES[mode] ?? PROMPT_STRATEGIES.collaborator;
}
