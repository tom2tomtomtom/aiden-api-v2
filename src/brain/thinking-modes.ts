/**
 * Thinking Modes Classifier
 *
 * Classifies AIDEN's thinking mode based on activated phantoms for cognitive transparency.
 * 6 modes: generative, analytical, persuasive, reflective, rapid, strategic.
 * Each mode has visual parameters for frontend visualization.
 *
 * Ported from: ~/aiden-unified/backend/aiden/core/thinking_modes.py (292 lines)
 * + ~/aiden-colleague/src/lib/ai/thinking-modes.ts
 * Full logic preserved including visual params and mode blend.
 */

import type { PhantomActivationScored, Phantom } from '../types.js';

// ── Types ───────────────────────────────────────────────────────────────────

export type ThinkingModeType =
  | 'generative'
  | 'analytical'
  | 'persuasive'
  | 'reflective'
  | 'rapid'
  | 'strategic';

export interface ThinkingModeVisualParams {
  primaryColor: string;
  glowColor: string;
  particleSpeed: number;
  orbitPattern: string;
  backgroundGradient: [string, string];
  modeBlend: Record<string, number>;
}

export interface ThinkingModeProfile {
  primaryMode: ThinkingModeType;
  modeScores: Record<ThinkingModeType, number>;
  confidence: number;
  activeInfluences: string[];
  visualParams: ThinkingModeVisualParams;
}

// ── Mode Configuration ──────────────────────────────────────────────────────

interface ModeConfig {
  originContexts: string[];
  influences: string[];
  weight: number;
}

const MODE_MAPPINGS: Record<ThinkingModeType, ModeConfig> = {
  generative: {
    originContexts: [
      'core_creative_identity',
      'creative_training_epoch',
      'creative_conviction',
      'aesthetic_depth',
      'narrative_intelligence',
      'creative_divergence',
    ],
    influences: [
      'DEFEND_CREATIVE_CHOICES',
      'TRUST_FIRST_INSTINCT',
      'BREAK_TEMPLATE',
      'BOLD_CHOICE',
      'UNIQUE_ANGLE',
    ],
    weight: 1.2,
  },
  analytical: {
    originContexts: [
      'evidence_mode',
      'proof_seeking',
      'strategic_clarity',
      'systems_thinking',
      'systems_economics',
      'behavioral_insight',
    ],
    influences: [
      'EVIDENCE_MODE',
      'SEEK_PROOF',
      'ANALYZE_DEEPLY',
      'STRUCTURE_THINKING',
      'DATA_DRIVEN',
    ],
    weight: 1.0,
  },
  persuasive: {
    originContexts: ['sell_mode', 'pitch_conviction', 'advocacy'],
    influences: ['SELL_IT', 'BUILD_CASE', 'ADVOCATE', 'CONVINCE', 'PITCH_PERFECT'],
    weight: 1.1,
  },
  reflective: {
    originContexts: [
      'personality_depth',
      'philosophical',
      'introspection',
      'philosophical_thinking',
      'epistemological_thinking',
      'historical_pattern',
    ],
    influences: [
      'THINK_DEEPLY',
      'QUESTION_ASSUMPTIONS',
      'REFLECT',
      'CONSIDER_ALTERNATIVES',
      'DOUBT_RESOLUTION',
    ],
    weight: 0.9,
  },
  rapid: {
    originContexts: ['spark_mode_brevity', 'brevity_control', 'quick_response'],
    influences: ['BE_BRIEF', 'SPARK_MODE', 'QUICK_HIT', 'DISTILL', 'NO_FLUFF'],
    weight: 1.0,
  },
  strategic: {
    originContexts: ['strategic_thinking', 'planning', 'systematic'],
    influences: ['STRATEGIC_VIEW', 'LONG_TERM', 'SYSTEMATIC', 'FRAMEWORK', 'ROADMAP'],
    weight: 1.0,
  },
};

// ── Visual Parameters Per Mode ──────────────────────────────────────────────

const MODE_VISUALS: Record<ThinkingModeType, Omit<ThinkingModeVisualParams, 'modeBlend'>> = {
  generative: {
    primaryColor: '#ff6b00',
    glowColor: '#ffeb3b',
    particleSpeed: 1.5,
    orbitPattern: 'chaotic',
    backgroundGradient: ['#1a0a00', '#2d1500'],
  },
  analytical: {
    primaryColor: '#00bcd4',
    glowColor: '#4dd0e1',
    particleSpeed: 0.8,
    orbitPattern: 'grid',
    backgroundGradient: ['#001a1a', '#002d2d'],
  },
  persuasive: {
    primaryColor: '#e91e63',
    glowColor: '#ff5722',
    particleSpeed: 1.2,
    orbitPattern: 'spiral',
    backgroundGradient: ['#1a0011', '#2d001d'],
  },
  reflective: {
    primaryColor: '#9c27b0',
    glowColor: '#7c4dff',
    particleSpeed: 0.5,
    orbitPattern: 'slow_orbit',
    backgroundGradient: ['#0a001a', '#150030'],
  },
  rapid: {
    primaryColor: '#ffeb3b',
    glowColor: '#ffffff',
    particleSpeed: 2.5,
    orbitPattern: 'burst',
    backgroundGradient: ['#1a1a00', '#2d2d00'],
  },
  strategic: {
    primaryColor: '#2196f3',
    glowColor: '#64b5f6',
    particleSpeed: 1.0,
    orbitPattern: 'geometric',
    backgroundGradient: ['#001a2d', '#002d4a'],
  },
};

// ── Mode Descriptions ───────────────────────────────────────────────────────

const MODE_DESCRIPTIONS: Record<ThinkingModeType, string> = {
  generative:
    'Divergent thinking - exploring possibilities, making unexpected connections, prioritizing novelty',
  analytical:
    'Logical analysis - structuring information, seeking evidence, systematic evaluation',
  persuasive:
    'Advocacy mode - building compelling arguments, selling ideas, creating conviction',
  reflective:
    'Deep consideration - questioning assumptions, exploring meaning, thoughtful introspection',
  rapid: 'Quick response - distilling to essence, brevity-first, immediate instinct',
  strategic:
    'Long-term view - systematic planning, considering implications, roadmap thinking',
};

// ── All Mode Types ──────────────────────────────────────────────────────────

const ALL_MODES: ThinkingModeType[] = [
  'generative',
  'analytical',
  'persuasive',
  'reflective',
  'rapid',
  'strategic',
];

// ── Classifier ──────────────────────────────────────────────────────────────

/**
 * Classify AIDEN's thinking mode from activated phantoms.
 *
 * Scores each mode based on phantom origin context and influence matches,
 * then normalizes to produce a confidence score. Returns the primary mode,
 * all mode scores, active influences, and visual parameters.
 */
export function classifyThinkingMode(
  activatedPhantoms: PhantomActivationScored[],
): ThinkingModeProfile {
  const modeScores: Record<ThinkingModeType, number> = {
    generative: 0,
    analytical: 0,
    persuasive: 0,
    reflective: 0,
    rapid: 0,
    strategic: 0,
  };

  const activeInfluences: string[] = [];

  for (const { phantom, score } of activatedPhantoms) {
    if (score <= 0) continue;

    const originContext = (phantom as Phantom).originContext ?? '';
    const influence = phantom.influence ?? '';

    // Score each mode based on phantom matches
    for (const mode of ALL_MODES) {
      const config = MODE_MAPPINGS[mode];
      let modeScore = 0.0;

      // Check origin context match
      if (config.originContexts.includes(originContext)) {
        modeScore += score * 2.0;
      }

      // Check influence match
      for (const inf of config.influences) {
        if (influence.toUpperCase().includes(inf)) {
          modeScore += score * 1.5;
          if (!activeInfluences.includes(influence)) {
            activeInfluences.push(influence);
          }
        }
      }

      modeScores[mode] += modeScore * config.weight;
    }
  }

  // Normalize scores
  const total = Object.values(modeScores).reduce((sum, v) => sum + v, 0);
  if (total > 0) {
    for (const mode of ALL_MODES) {
      modeScores[mode] /= total;
    }
  }

  // Find primary mode
  let primaryMode: ThinkingModeType = 'generative'; // default
  let confidence = 0.3;

  if (total > 0) {
    primaryMode = ALL_MODES.reduce((best, mode) =>
      modeScores[mode] > modeScores[best] ? mode : best,
    );
    confidence = modeScores[primaryMode];
  }

  // Get visual params with mode blend
  const modeBlend = calculateModeBlend(modeScores);

  return {
    primaryMode,
    modeScores,
    confidence,
    activeInfluences: activeInfluences.slice(0, 10),
    visualParams: {
      ...MODE_VISUALS[primaryMode],
      modeBlend,
    },
  };
}

/**
 * Calculate blend weights for multi-mode visualization.
 * Returns top 3 modes with scores above 0.1.
 */
function calculateModeBlend(
  modeScores: Record<ThinkingModeType, number>,
): Record<string, number> {
  const sorted = Object.entries(modeScores).sort(([, a], [, b]) => b - a);
  const blend: Record<string, number> = {};
  for (const [mode, score] of sorted.slice(0, 3)) {
    if (score > 0.1) {
      blend[mode] = score;
    }
  }
  return blend;
}

/**
 * Get human-readable description of a thinking mode.
 */
export function getThinkingModeDescription(mode: ThinkingModeType): string {
  return MODE_DESCRIPTIONS[mode] ?? '';
}

/**
 * Generate metadata for cognitive transparency display.
 */
export function generateTransparencyMetadata(profile: ThinkingModeProfile): {
  thinkingMode: {
    primary: ThinkingModeType;
    description: string;
    scores: Record<ThinkingModeType, number>;
    confidence: number;
  };
  activeInfluences: string[];
  visualization: ThinkingModeVisualParams;
} {
  return {
    thinkingMode: {
      primary: profile.primaryMode,
      description: getThinkingModeDescription(profile.primaryMode),
      scores: profile.modeScores,
      confidence: profile.confidence,
    },
    activeInfluences: profile.activeInfluences,
    visualization: profile.visualParams,
  };
}
