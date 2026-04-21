/**
 * Phantom Alliances
 *
 * Phantoms that consistently co-activate and produce good output develop
 * relationships. These "alliances" create emergent creative habits:
 * pairs that work well together fire together more often.
 *
 * After each response with feedback:
 * - For every pair of active phantoms, increment co_activation_count
 * - If feedback positive, increment positive_co_activation_count
 * - Recalculate alliance_strength = positive / total
 *
 * During phantom activation:
 * - After initial scoring, check alliances with already-activated phantoms
 * - If phantom A activated and has alliance_strength > 0.7 with phantom B,
 *   boost B by alliance_strength * 0.3
 *
 * Alliance decay: remove if strength drops below 0.2
 */

import type { PhantomActivationScored } from '../types.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PhantomAlliance {
  tenantId: string;
  phantomAId: string;
  phantomBId: string;
  coActivationCount: number;
  positiveCoActivationCount: number;
  allianceStrength: number;
}

export interface AllianceUpdate {
  phantomAId: string;
  phantomBId: string;
  newStrength: number;
  coActivations: number;
  positiveCoActivations: number;
  action: 'created' | 'strengthened' | 'weakened' | 'removed';
}

export interface AllianceBoost {
  phantomId: string;
  allyId: string;
  allianceStrength: number;
  boostAmount: number;
}

/**
 * Database interface for alliance persistence.
 */
export interface AllianceDB {
  getAlliance(tenantId: string, phantomAId: string, phantomBId: string): Promise<PhantomAlliance | null>;
  upsertAlliance(alliance: PhantomAlliance): Promise<void>;
  removeAlliance(tenantId: string, phantomAId: string, phantomBId: string): Promise<void>;
  getAlliancesForPhantom(tenantId: string, phantomId: string): Promise<PhantomAlliance[]>;
  getStrongAlliances(tenantId: string, minStrength: number): Promise<PhantomAlliance[]>;
}

// ── Constants ───────────────────────────────────────────────────────────────

const ALLIANCE_BOOST_THRESHOLD = 0.7;
const ALLIANCE_BOOST_MULTIPLIER = 0.3;
const ALLIANCE_DECAY_THRESHOLD = 0.2;
const MIN_CO_ACTIVATIONS_FOR_ALLIANCE = 3;

// ── Core Alliance Processing ────────────────────────────────────────────────

/**
 * Normalize pair ordering so (A, B) and (B, A) map to the same record.
 * Always puts the lexicographically smaller ID first.
 */
function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Record co-activation for all pairs of active phantoms after a response.
 * If feedback is positive, also increments positive co-activation count.
 *
 * @param tenantId - The tenant these phantoms belong to
 * @param activePhantomIds - IDs of phantoms that were active for this response
 * @param isPositiveFeedback - Whether the feedback was positive
 * @param db - Database interface
 * @returns List of alliance updates
 */
export async function recordCoActivation(
  tenantId: string,
  activePhantomIds: string[],
  isPositiveFeedback: boolean,
  db: AllianceDB,
): Promise<AllianceUpdate[]> {
  if (activePhantomIds.length < 2) return [];

  const updates: AllianceUpdate[] = [];

  // Generate all pairs
  for (let i = 0; i < activePhantomIds.length; i++) {
    for (let j = i + 1; j < activePhantomIds.length; j++) {
      const [phantomAId, phantomBId] = normalizePair(activePhantomIds[i], activePhantomIds[j]);

      // Get existing alliance or create new
      let alliance = await db.getAlliance(tenantId, phantomAId, phantomBId);

      if (!alliance) {
        alliance = {
          tenantId,
          phantomAId,
          phantomBId,
          coActivationCount: 0,
          positiveCoActivationCount: 0,
          allianceStrength: 0,
        };
      }

      // Increment counts
      alliance.coActivationCount++;
      if (isPositiveFeedback) {
        alliance.positiveCoActivationCount++;
      }

      // Recalculate strength
      const newStrength = alliance.coActivationCount > 0
        ? alliance.positiveCoActivationCount / alliance.coActivationCount
        : 0;
      alliance.allianceStrength = newStrength;

      // Determine action
      let action: AllianceUpdate['action'];
      if (newStrength < ALLIANCE_DECAY_THRESHOLD && alliance.coActivationCount >= MIN_CO_ACTIVATIONS_FOR_ALLIANCE) {
        // Alliance has decayed below threshold. Remove it.
        await db.removeAlliance(tenantId, phantomAId, phantomBId);
        action = 'removed';
      } else {
        await db.upsertAlliance(alliance);
        if (alliance.coActivationCount === 1) {
          action = 'created';
        } else if (isPositiveFeedback) {
          action = 'strengthened';
        } else {
          action = 'weakened';
        }
      }

      updates.push({
        phantomAId,
        phantomBId,
        newStrength,
        coActivations: alliance.coActivationCount,
        positiveCoActivations: alliance.positiveCoActivationCount,
        action,
      });
    }
  }

  const strongAlliances = updates.filter(u => u.newStrength >= ALLIANCE_BOOST_THRESHOLD);
  if (strongAlliances.length > 0) {
    console.log(
      `[PhantomAlliances] ${updates.length} pairs updated, ` +
      `${strongAlliances.length} strong alliances (>0.7)`,
    );
  }

  return updates;
}

/**
 * Apply alliance boosts to phantom activations.
 *
 * After initial scoring, check if any already-activated phantoms have
 * strong alliances with other phantoms. If so, boost those allies.
 *
 * @param activations - Current phantom activations (sorted by score desc)
 * @param tenantId - Tenant ID
 * @param db - Database interface
 * @returns Updated activations with alliance boosts applied
 */
export async function applyAllianceBoosts(
  activations: PhantomActivationScored[],
  tenantId: string,
  db: AllianceDB,
): Promise<{ activations: PhantomActivationScored[]; boosts: AllianceBoost[] }> {
  const boosts: AllianceBoost[] = [];

  // Get the top activated phantoms (those with score > 0)
  const activated = activations.filter(a => a.score > 0);
  if (activated.length < 2) return { activations, boosts };

  // Build a map for quick lookup
  const activationMap = new Map<string, PhantomActivationScored>();
  for (const a of activations) {
    activationMap.set(a.key, a);
  }

  // For each activated phantom, check its alliances
  for (const active of activated) {
    const alliances = await db.getAlliancesForPhantom(tenantId, active.key);

    for (const alliance of alliances) {
      if (alliance.allianceStrength < ALLIANCE_BOOST_THRESHOLD) continue;
      if (alliance.coActivationCount < MIN_CO_ACTIVATIONS_FOR_ALLIANCE) continue;

      // Find the ally in the activation list
      const allyId = alliance.phantomAId === active.key ? alliance.phantomBId : alliance.phantomAId;
      const ally = activationMap.get(allyId);

      if (ally) {
        const boostAmount = alliance.allianceStrength * ALLIANCE_BOOST_MULTIPLIER;
        ally.score += boostAmount;

        boosts.push({
          phantomId: allyId,
          allyId: active.key,
          allianceStrength: alliance.allianceStrength,
          boostAmount,
        });
      }
    }
  }

  // Re-sort after boosts
  if (boosts.length > 0) {
    activations.sort((a, b) => b.score - a.score);
    console.log(
      `[PhantomAlliances] Applied ${boosts.length} alliance boosts`,
    );
  }

  return { activations, boosts };
}

/**
 * Get alliance data for the stats endpoint.
 */
export async function getAllianceStats(
  tenantId: string,
  db: AllianceDB,
): Promise<PhantomAlliance[]> {
  return db.getStrongAlliances(tenantId, 0.5);
}

// ── Export constants for testing ────────────────────────────────────────────

export {
  ALLIANCE_BOOST_THRESHOLD,
  ALLIANCE_BOOST_MULTIPLIER,
  ALLIANCE_DECAY_THRESHOLD,
  MIN_CO_ACTIVATIONS_FOR_ALLIANCE,
};
