/**
 * Feedback Loop - Learning from Usage
 *
 * The deepest moat. Every interaction teaches the system what works.
 * Tracks which phantoms were active when a response was generated,
 * stores phantom snapshots per response, and adjusts phantom weights
 * based on user feedback signals.
 *
 * Feedback types:
 * - positive: thumbs up, "that's good" (+0.08 * phantom_score/max_score)
 * - negative: thumbs down, regenerate (-0.03, flag if 3+ in 30 days)
 * - used: copied/exported without editing (+0.12, strongest signal)
 * - edited: user modified output (neutral, log changes)
 * - regenerated: user asked for another attempt (-0.03)
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type FeedbackType = 'positive' | 'negative' | 'used' | 'regenerated' | 'edited';

export interface PhantomSnapshot {
  id: string;
  score: number;
  weight: number;
}

export interface FeedbackRecord {
  id?: string;
  tenantId: string;
  conversationId: string;
  messageId: string;
  phantomsActive: PhantomSnapshot[];
  feedbackType: FeedbackType;
  editedContent?: string;
  createdAt?: string;
}

export interface FeedbackWeightChange {
  phantomId: string;
  oldWeight: number;
  newWeight: number;
  delta: number;
  reason: string;
}

export interface FeedbackResult {
  weightChanges: FeedbackWeightChange[];
  flaggedForReview: string[];
}

export interface PhantomFeedbackStats {
  phantomId: string;
  totalActivations: number;
  positiveCount: number;
  negativeCount: number;
  usedCount: number;
  positiveFeedbackRate: number;
  recentNegatives: number; // in last 30 days
  flaggedForReview: boolean;
}

/**
 * Database interface for feedback persistence.
 * Injected to allow testing without a real database.
 */
export interface FeedbackDB {
  storeFeedback(record: FeedbackRecord): Promise<void>;
  getPhantomWeight(tenantId: string, phantomId: string): Promise<number | null>;
  updatePhantomWeight(tenantId: string, phantomId: string, newWeight: number): Promise<void>;
  getRecentNegatives(tenantId: string, phantomId: string, days: number): Promise<number>;
  getPhantomFeedbackStats(tenantId: string, phantomId: string): Promise<PhantomFeedbackStats | null>;
  getAggregateStats(tenantId: string): Promise<PhantomFeedbackStats[]>;
}

// ── Constants ───────────────────────────────────────────────────────────────

const POSITIVE_BOOST_BASE = 0.08;
const NEGATIVE_PENALTY = -0.03;
const USED_BOOST = 0.12;
const NEGATIVE_FLAG_THRESHOLD = 3;
const NEGATIVE_FLAG_WINDOW_DAYS = 30;
const MAX_WEIGHT = 10.0;
const MIN_WEIGHT = 0.0;

// ── Core Feedback Processing ────────────────────────────────────────────────

/**
 * Process feedback for a message and adjust phantom weights accordingly.
 *
 * On positive feedback: boost active phantoms proportional to activation score.
 * On negative feedback: small penalty, flag for review if repeated.
 * On "used": strongest positive signal.
 * On "edited": neutral, just log.
 * On "regenerated": same as negative.
 */
export async function processFeedback(
  record: FeedbackRecord,
  db: FeedbackDB,
): Promise<FeedbackResult> {
  // Store the feedback record
  await db.storeFeedback(record);

  const result: FeedbackResult = {
    weightChanges: [],
    flaggedForReview: [],
  };

  // Edited feedback is neutral. No weight changes.
  if (record.feedbackType === 'edited') {
    return result;
  }

  const { phantomsActive, tenantId, feedbackType } = record;
  if (!phantomsActive.length) return result;

  // Calculate max score for proportional boosting
  const maxScore = Math.max(...phantomsActive.map(p => p.score), 0.01);

  for (const phantom of phantomsActive) {
    const currentWeight = await db.getPhantomWeight(tenantId, phantom.id);
    if (currentWeight === null) continue; // Phantom not found or is a base phantom

    let delta = 0;
    let reason = '';

    switch (feedbackType) {
      case 'positive':
        // Boost proportional to activation score
        delta = POSITIVE_BOOST_BASE * (phantom.score / maxScore);
        reason = `positive feedback (score ratio: ${(phantom.score / maxScore).toFixed(3)})`;
        break;

      case 'used':
        // Strongest signal. Flat boost.
        delta = USED_BOOST;
        reason = 'output used without editing';
        break;

      case 'negative':
      case 'regenerated':
        delta = NEGATIVE_PENALTY;
        reason = `${feedbackType} feedback`;

        // Check if phantom should be flagged for review
        const recentNegatives = await db.getRecentNegatives(
          tenantId,
          phantom.id,
          NEGATIVE_FLAG_WINDOW_DAYS,
        );
        if (recentNegatives + 1 >= NEGATIVE_FLAG_THRESHOLD) {
          result.flaggedForReview.push(phantom.id);
        }
        break;
    }

    if (delta !== 0) {
      const newWeight = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, currentWeight + delta));
      await db.updatePhantomWeight(tenantId, phantom.id, newWeight);

      result.weightChanges.push({
        phantomId: phantom.id,
        oldWeight: currentWeight,
        newWeight,
        delta,
        reason,
      });
    }
  }

  if (result.weightChanges.length > 0) {
    console.log(
      `[FeedbackLoop] Processed ${feedbackType} feedback: ` +
      `${result.weightChanges.length} weight changes, ` +
      `${result.flaggedForReview.length} flagged for review`,
    );
  }

  return result;
}

/**
 * Get aggregated feedback stats for all phantoms in a tenant.
 * Used by the phantoms/stats endpoint.
 */
export async function getPhantomFeedbackSummary(
  tenantId: string,
  db: FeedbackDB,
): Promise<PhantomFeedbackStats[]> {
  return db.getAggregateStats(tenantId);
}

// ── Export constants for testing ────────────────────────────────────────────

export {
  POSITIVE_BOOST_BASE,
  NEGATIVE_PENALTY,
  USED_BOOST,
  NEGATIVE_FLAG_THRESHOLD,
  NEGATIVE_FLAG_WINDOW_DAYS,
};
