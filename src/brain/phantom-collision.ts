/**
 * Phantom Collision Detection
 *
 * Detects when two phantoms with semantically opposing influences both activate
 * above a high threshold. Returns creative tension objects that can be injected
 * into the system prompt, forcing AIDEN to voice the friction.
 *
 * Ported from: ~/aiden-colleague/src/lib/ai/phantom-collision.ts
 * All 4 opposing pairs preserved. 0.85 threshold preserved.
 */

import type {
  PhantomActivationScored,
  PhantomCollision,
  OpposingPair,
} from '../types.js';

// ── Opposing influence pairs ─────────────────────────────────────────────────

/**
 * If both sides of a pair activate above the collision threshold,
 * a creative tension is detected.
 */
const OPPOSING_PAIRS: OpposingPair[] = [
  {
    sideAKeywords: [
      'MINIMALISM', 'BRIEF', 'ULTRA_BRIEF', 'BREVITY', 'CONCISE', 'SURGICAL', 'ESSENCE',
      'MINIMUM_WORDS', 'SINGLE_WORD', 'LIGHTNING', 'PRECISE',
    ],
    sideBKeywords: [
      'COMPREHENSIVE', 'DEEP', 'ELABORATE', 'THOROUGH', 'DETAILED', 'MULTI_ANGLE',
      'PROVIDE_COMPREHENSIVE', 'COMPLEX', 'SYSTEMATIC',
    ],
    tensionDescription: 'minimalism vs depth',
  },
  {
    sideAKeywords: [
      'CONSERVATIVE', 'SAFE', 'CAUTIOUS', 'SIMPLE', 'CHECK_SIMPLE',
      'GROUND_IN', 'VERIFY', 'INCREMENTAL', 'EVOLUTION',
    ],
    sideBKeywords: [
      'BOLD', 'WILD', 'SURPRISE', 'SUBVERT', 'VIOLATE', 'OPPOSITE',
      'BIZARRE', 'ABSURDITY', 'UNEXPECTED', 'HUNT_AND_VIOLATE', 'DO_THE_EXACT_OPPOSITE',
    ],
    tensionDescription: 'conservative vs bold/wild',
  },
  {
    sideAKeywords: [
      'BRIEF', 'CONCISE', 'RESPOND_BRIEFLY', 'BE_BRIEF', 'BE_ULTRA_BRIEF',
      'SURGICAL_CREATIVE_PRECISION', 'MAXIMUM_IMPACT_MINIMUM_WORDS', 'SINGLE_WORD',
    ],
    sideBKeywords: [
      'COMPREHENSIVE', 'DEEP', 'THOROUGH', 'MULTI_ANGLE', 'PROVIDE_COMPREHENSIVE',
      'DETAILED', 'ELABORATE',
    ],
    tensionDescription: 'brief/concise vs deep/comprehensive',
  },
  {
    sideAKeywords: [
      'VALIDATE', 'AGREE', 'MIRROR', 'ACKNOWLEDGE', 'AMPLIFY_COLLABORATIVE',
      'EMBRACE', 'COLLABORATIVE', 'VALUE_RELATIONSHIP',
    ],
    sideBKeywords: [
      'CHALLENGE', 'PUSH_BACK', 'REJECT', 'DISAGREE', 'CONTRADICT', 'DEMOLISH',
      'DESTROY', 'SHARPEN_THROUGH_INTELLECTUAL_CONFLICT', 'CHALLENGE_DIRECTLY',
      'CHALLENGE_ASSUMPTIONS',
    ],
    tensionDescription: 'agree/validate vs challenge/push back',
  },
];

/** Score threshold for a phantom to be considered "strongly activated" */
const COLLISION_THRESHOLD = 0.85;

// ── Helper ───────────────────────────────────────────────────────────────────

function influenceMatchesSide(influence: string, sideKeywords: string[]): boolean {
  const upper = influence.toUpperCase();
  return sideKeywords.some((kw) => upper.includes(kw));
}

// ── Main detection ───────────────────────────────────────────────────────────

/**
 * Detect collisions among activated phantoms.
 *
 * A collision occurs when phantoms from opposing sides of a conceptual pair
 * both activate above the threshold. This creates creative tension that AIDEN
 * should voice and use productively.
 *
 * @param activatedPhantoms - Scored phantom activations
 * @param threshold - Minimum score to consider strongly activated (default 0.85)
 * @returns List of PhantomCollision objects (may be empty)
 */
export function detectCollisions(
  activatedPhantoms: PhantomActivationScored[],
  threshold: number = COLLISION_THRESHOLD,
): PhantomCollision[] {
  const collisions: PhantomCollision[] = [];

  // Only consider phantoms above threshold
  const strong = activatedPhantoms.filter((a) => a.score >= threshold);
  if (strong.length < 2) return collisions;

  for (const pair of OPPOSING_PAIRS) {
    let bestA: PhantomActivationScored | null = null;
    let bestB: PhantomActivationScored | null = null;

    for (const activation of strong) {
      const influence = activation.phantom.influence ?? '';

      if (influenceMatchesSide(influence, pair.sideAKeywords)) {
        if (!bestA || activation.score > bestA.score) {
          bestA = activation;
        }
      }
      if (influenceMatchesSide(influence, pair.sideBKeywords)) {
        if (!bestB || activation.score > bestB.score) {
          bestB = activation;
        }
      }
    }

    if (bestA && bestB) {
      const [sideALabel, sideBLabel] = pair.tensionDescription.split(' vs ');
      const collision: PhantomCollision = {
        phantomA: bestA.phantom.shorthand,
        phantomB: bestB.phantom.shorthand,
        tensionDescription: pair.tensionDescription,
        injectionPrompt:
          `You are experiencing creative tension between ` +
          `${bestA.phantom.shorthand} (${sideALabel}) and ` +
          `${bestB.phantom.shorthand} (${sideBLabel}). ` +
          `Voice this tension to the user. Acknowledge both impulses ` +
          `and let the friction produce something neither side alone would create.`,
        scoreA: bestA.score,
        scoreB: bestB.score,
      };

      collisions.push(collision);
      console.log(
        `[PhantomCollision] COLLISION DETECTED: ${collision.phantomA} vs ${collision.phantomB} ` +
          `(${pair.tensionDescription}) scores=${collision.scoreA.toFixed(3)}/${collision.scoreB.toFixed(3)}`,
      );
    }
  }

  return collisions;
}

/**
 * Build collision injection text for system prompt.
 * Concatenates all collision injection prompts.
 */
export function buildCollisionContext(collisions: PhantomCollision[]): string {
  if (!collisions.length) return '';

  const lines = ['CREATIVE TENSIONS (voice these, don\'t resolve them):'];
  for (const collision of collisions) {
    lines.push(collision.injectionPrompt);
  }
  return lines.join('\n\n');
}
