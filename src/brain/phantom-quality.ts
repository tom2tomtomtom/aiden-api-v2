/**
 * Phantom Quality Scoring
 *
 * Continuous quality measurement for phantoms. They earn their place.
 * Tracks activation count, positive feedback rate, collision contribution,
 * and decay velocity over a rolling 30-day window.
 *
 * Quality score (0-10):
 *   0-3: low quality. Fires often but rarely produces good output. Candidate for decay acceleration.
 *   4-6: average. Fires and sometimes works. Neutral.
 *   7-10: high quality. Consistently contributes to good output. Candidate for weight boost.
 *
 * Weekly automated review: phantoms scoring below 2.0 for 4 consecutive weeks
 * get archived (unless they are core conviction phantoms).
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface PhantomQualityMetrics {
  phantomId: string;
  tenantId: string;
  activationCount: number;
  positiveFeedbackRate: number; // 0.0-1.0
  collisionContribution: number; // 0.0-1.0
  decayVelocity: number; // weight lost per day (negative = growing)
  qualityScore: number; // 0-10
  consecutiveWeeksBelowThreshold: number;
  isArchiveCandidate: boolean;
  isCoreConviction: boolean;
}

export interface QualityReviewResult {
  reviewed: number;
  archived: string[];
  boosted: string[];
  warnings: string[];
}

/**
 * Database interface for quality scoring persistence.
 */
export interface QualityDB {
  getPhantomMetrics(tenantId: string, phantomId: string, windowDays: number): Promise<{
    activationCount: number;
    positiveCount: number;
    totalFeedbackCount: number;
    positiveCollisionCount: number;
    totalCollisionCount: number;
    weightHistory: Array<{ weight: number; date: string }>;
  } | null>;
  getAllPhantomIds(tenantId: string): Promise<Array<{ id: string; isCoreConviction: boolean }>>;
  archivePhantom(tenantId: string, phantomId: string): Promise<void>;
  updateQualityScore(tenantId: string, phantomId: string, score: number): Promise<void>;
  getConsecutiveWeeksBelowThreshold(tenantId: string, phantomId: string, threshold: number): Promise<number>;
}

// ── Constants ───────────────────────────────────────────────────────────────

const ROLLING_WINDOW_DAYS = 30;
const ARCHIVE_THRESHOLD = 2.0;
const ARCHIVE_WEEKS_REQUIRED = 4;
const HIGH_QUALITY_THRESHOLD = 7.0;
const LOW_QUALITY_THRESHOLD = 3.0;

// Weight factors for quality score calculation
const WEIGHT_ACTIVATION = 0.2;
const WEIGHT_FEEDBACK_RATE = 0.4;
const WEIGHT_COLLISION = 0.2;
const WEIGHT_STABILITY = 0.2;

// ── Core Quality Scoring ────────────────────────────────────────────────────

/**
 * Compute quality score for a single phantom.
 *
 * Score components:
 * 1. Activation frequency (normalized): are people triggering this phantom?
 * 2. Positive feedback rate: when it fires, does it produce good output?
 * 3. Collision contribution: does it participate in productive creative tensions?
 * 4. Stability: is it growing or decaying? (growth = high quality signal)
 */
export function computeQualityScore(metrics: {
  activationCount: number;
  positiveFeedbackRate: number;
  collisionContribution: number;
  decayVelocity: number;
}): number {
  // Activation score: 0-10, normalized. 20+ activations in 30 days = max.
  const activationScore = Math.min(metrics.activationCount / 20, 1.0) * 10;

  // Feedback rate: direct mapping to 0-10
  const feedbackScore = metrics.positiveFeedbackRate * 10;

  // Collision contribution: direct mapping to 0-10
  const collisionScore = metrics.collisionContribution * 10;

  // Stability: negative decay velocity = growing = good
  // Range: -0.1 to +0.1 per day mapped to 0-10
  const stabilityScore = Math.max(0, Math.min(10, 5 - (metrics.decayVelocity * 50)));

  const qualityScore =
    activationScore * WEIGHT_ACTIVATION +
    feedbackScore * WEIGHT_FEEDBACK_RATE +
    collisionScore * WEIGHT_COLLISION +
    stabilityScore * WEIGHT_STABILITY;

  return Math.max(0, Math.min(10, qualityScore));
}

/**
 * Calculate decay velocity from weight history.
 * Returns weight change per day (positive = decaying, negative = growing).
 */
export function calculateDecayVelocity(
  weightHistory: Array<{ weight: number; date: string }>,
): number {
  if (weightHistory.length < 2) return 0;

  const sorted = [...weightHistory].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const daysDiff = (new Date(last.date).getTime() - new Date(first.date).getTime()) / (1000 * 60 * 60 * 24);

  if (daysDiff === 0) return 0;

  // Positive = decaying (first weight > last weight means it lost weight)
  return (first.weight - last.weight) / daysDiff;
}

/**
 * Evaluate quality for a single phantom.
 */
export async function evaluatePhantomQuality(
  tenantId: string,
  phantomId: string,
  isCoreConviction: boolean,
  db: QualityDB,
): Promise<PhantomQualityMetrics | null> {
  const metrics = await db.getPhantomMetrics(tenantId, phantomId, ROLLING_WINDOW_DAYS);
  if (!metrics) return null;

  const positiveFeedbackRate = metrics.totalFeedbackCount > 0
    ? metrics.positiveCount / metrics.totalFeedbackCount
    : 0;

  const collisionContribution = metrics.totalCollisionCount > 0
    ? metrics.positiveCollisionCount / metrics.totalCollisionCount
    : 0;

  const decayVelocity = calculateDecayVelocity(metrics.weightHistory);

  const qualityScore = computeQualityScore({
    activationCount: metrics.activationCount,
    positiveFeedbackRate,
    collisionContribution,
    decayVelocity,
  });

  const consecutiveWeeks = await db.getConsecutiveWeeksBelowThreshold(
    tenantId,
    phantomId,
    ARCHIVE_THRESHOLD,
  );

  const isArchiveCandidate = !isCoreConviction &&
    qualityScore < ARCHIVE_THRESHOLD &&
    consecutiveWeeks >= ARCHIVE_WEEKS_REQUIRED;

  return {
    phantomId,
    tenantId,
    activationCount: metrics.activationCount,
    positiveFeedbackRate,
    collisionContribution,
    decayVelocity,
    qualityScore,
    consecutiveWeeksBelowThreshold: consecutiveWeeks,
    isArchiveCandidate,
    isCoreConviction,
  };
}

/**
 * Run weekly quality review for all phantoms in a tenant.
 * Archives low-quality phantoms (except core conviction).
 */
export async function runWeeklyQualityReview(
  tenantId: string,
  db: QualityDB,
): Promise<QualityReviewResult> {
  const result: QualityReviewResult = {
    reviewed: 0,
    archived: [],
    boosted: [],
    warnings: [],
  };

  const phantoms = await db.getAllPhantomIds(tenantId);
  result.reviewed = phantoms.length;

  for (const { id, isCoreConviction } of phantoms) {
    const quality = await evaluatePhantomQuality(tenantId, id, isCoreConviction, db);
    if (!quality) continue;

    // Update quality score in DB
    await db.updateQualityScore(tenantId, id, quality.qualityScore);

    // Archive candidates
    if (quality.isArchiveCandidate) {
      await db.archivePhantom(tenantId, id);
      result.archived.push(id);
      console.log(
        `[PhantomQuality] ARCHIVED: ${id} (score: ${quality.qualityScore.toFixed(1)}, ` +
        `weeks below threshold: ${quality.consecutiveWeeksBelowThreshold})`,
      );
    }

    // Flag high quality
    if (quality.qualityScore >= HIGH_QUALITY_THRESHOLD) {
      result.boosted.push(id);
    }

    // Warn about declining phantoms
    if (quality.qualityScore < LOW_QUALITY_THRESHOLD && !isCoreConviction) {
      result.warnings.push(
        `Phantom ${id} scoring ${quality.qualityScore.toFixed(1)} ` +
        `(week ${quality.consecutiveWeeksBelowThreshold} below threshold)`,
      );
    }
  }

  console.log(
    `[PhantomQuality] Weekly review: ${result.reviewed} reviewed, ` +
    `${result.archived.length} archived, ${result.boosted.length} high-quality`,
  );

  return result;
}

// ── Exports for testing ────────────────────────────────────────────────────

export {
  ROLLING_WINDOW_DAYS,
  ARCHIVE_THRESHOLD,
  ARCHIVE_WEEKS_REQUIRED,
  HIGH_QUALITY_THRESHOLD,
  LOW_QUALITY_THRESHOLD,
};
