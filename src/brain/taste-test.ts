/**
 * Cold Start Taste Test
 *
 * 5 polarizing creative preference questions for onboarding.
 * User choices seed initial phantom weights, giving the system
 * immediate personality calibration before any conversation history exists.
 *
 * Ported from: ~/aiden-unified/backend/aiden/core/phantom_evolution.py
 * (get_taste_test_questions and process_taste_test methods)
 * Full logic preserved.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export interface TasteTestChoice {
  label: string;
  phantomSeeds: string[];
  weightBoost: number;
}

export interface TasteTestQuestion {
  id: string;
  question: string;
  choiceA: TasteTestChoice;
  choiceB: TasteTestChoice;
}

export interface TasteTestAnswer {
  questionId: string;
  selected: 'a' | 'b';
}

export interface SeededPhantom {
  shorthand: string;
  feelingSeed: string;
  phantomStory: string;
  influence: string;
  weight: number;
  originType: 'seeded';
  isCoreConviction: boolean;
  minWeightFloor: number | null;
}

/**
 * Persistence provider for taste test results.
 */
export interface TasteTestPersistence {
  createUserPhantom(phantom: SeededPhantom): Promise<string | null>;
  recordTasteTestResult(data: {
    userId: string;
    questionId: string;
    choiceALabel: string;
    choiceBLabel: string;
    selected: 'a' | 'b';
    phantomsSeeded: string[];
  }): Promise<void>;
}

// ── Core conviction set (shared with phantom-evolution) ─────────────────────

import { CORE_CONVICTION_PHANTOMS, MIN_WEIGHT_FLOOR } from './phantom-evolution.js';

// ── Questions ───────────────────────────────────────────────────────────────

export const TASTE_TEST_QUESTIONS: TasteTestQuestion[] = [
  {
    id: 'bold_vs_safe',
    question: 'Which campaign would you green-light?',
    choiceA: {
      label: 'A billboard with just the brand name. Nothing else.',
      phantomSeeds: [
        'minimalist_conviction',
        'restraint_as_power',
        'silence_as_statement',
      ],
      weightBoost: 0.5,
    },
    choiceB: {
      label: 'A 360 immersive experience with AR, influencers, and a pop-up store.',
      phantomSeeds: [
        'maximalist_ambition',
        'experience_architect',
        'spectacle_value',
      ],
      weightBoost: 0.5,
    },
  },
  {
    id: 'provoke_vs_charm',
    question: 'Which headline wins?',
    choiceA: {
      label: "You're wrong about everything you think you know about skincare.",
      phantomSeeds: [
        'challenger_instinct',
        'creative_stubborn',
        'sacred_cow_killer',
      ],
      weightBoost: 0.5,
    },
    choiceB: {
      label: "The kindest thing you'll do for your skin today.",
      phantomSeeds: [
        'empathy_first',
        'warmth_precision',
        'emotional_intelligence',
      ],
      weightBoost: 0.5,
    },
  },
  {
    id: 'data_vs_gut',
    question: 'How do you make the final call on a campaign?',
    choiceA: {
      label: 'Test it. A/B test, focus groups, data wins.',
      phantomSeeds: [
        'evidence_hunter',
        'data_conviction',
        'systematic_thinker',
      ],
      weightBoost: 0.5,
    },
    choiceB: {
      label: 'Trust the gut. If it gives you chills, ship it.',
      phantomSeeds: [
        'gut_first',
        'instinct_over_process',
        'creative_courage',
      ],
      weightBoost: 0.5,
    },
  },
  {
    id: 'polish_vs_raw',
    question: 'Which production style for a launch film?',
    choiceA: {
      label: 'Shot on iPhone. Real people. No script.',
      phantomSeeds: [
        'authenticity_radar',
        'raw_over_polished',
        'truth_seeking',
      ],
      weightBoost: 0.5,
    },
    choiceB: {
      label: 'Directed by Spike Jonze. Every frame a painting.',
      phantomSeeds: [
        'craft_obsession',
        'visual_perfectionist',
        'cinema_instinct',
      ],
      weightBoost: 0.5,
    },
  },
  {
    id: 'disrupt_vs_own',
    question: 'Your competitor owns the category. Your move?',
    choiceA: {
      label: 'Burn the category down. Redefine the rules.',
      phantomSeeds: [
        'category_destroyer',
        'contrarian_instinct',
        'disruption_gene',
      ],
      weightBoost: 0.5,
    },
    choiceB: {
      label: 'Out-execute them. Better product, better story, better consistency.',
      phantomSeeds: [
        'execution_excellence',
        'strategy_patience',
        'long_game_thinker',
      ],
      weightBoost: 0.5,
    },
  },
];

// ── Core Functions ──────────────────────────────────────────────────────────

/**
 * Get the 5 taste test questions for onboarding.
 */
export function getTasteTestQuestions(): TasteTestQuestion[] {
  return TASTE_TEST_QUESTIONS;
}

/**
 * Process taste test answers and return phantom seed data.
 *
 * For each answer, returns the phantom seeds with appropriate weights.
 * Caller is responsible for persisting via the injected provider.
 *
 * @param answers - List of question answers
 * @returns List of phantom seeds to create
 */
export function processTasteTestAnswers(answers: TasteTestAnswer[]): SeededPhantom[] {
  const questionMap = new Map(TASTE_TEST_QUESTIONS.map((q) => [q.id, q]));
  const seededPhantoms: SeededPhantom[] = [];

  for (const answer of answers) {
    const question = questionMap.get(answer.questionId);
    if (!question || (answer.selected !== 'a' && answer.selected !== 'b')) {
      continue;
    }

    const choice = answer.selected === 'a' ? question.choiceA : question.choiceB;
    const weightBoost = choice.weightBoost;

    for (const seedName of choice.phantomSeeds) {
      const isCoreConviction = CORE_CONVICTION_PHANTOMS.has(seedName);

      seededPhantoms.push({
        shorthand: seedName,
        feelingSeed: `Creative instinct toward ${seedName.replace(/_/g, ' ')}`,
        phantomStory: `Seeded from taste test: chose '${choice.label}'`,
        influence: seedName.toUpperCase(),
        weight: 3.0 + weightBoost,
        originType: 'seeded',
        isCoreConviction,
        minWeightFloor: isCoreConviction ? MIN_WEIGHT_FLOOR : null,
      });
    }
  }

  return seededPhantoms;
}

/**
 * Full taste test pipeline with persistence.
 *
 * @param userId - The user being onboarded
 * @param answers - Their taste test answers
 * @param persistence - Injected persistence provider
 * @returns List of created phantom IDs
 */
export async function runTasteTest(
  userId: string,
  answers: TasteTestAnswer[],
  persistence: TasteTestPersistence,
): Promise<string[]> {
  const questionMap = new Map(TASTE_TEST_QUESTIONS.map((q) => [q.id, q]));
  const seededIds: string[] = [];

  for (const answer of answers) {
    const question = questionMap.get(answer.questionId);
    if (!question || (answer.selected !== 'a' && answer.selected !== 'b')) {
      continue;
    }

    const choice = answer.selected === 'a' ? question.choiceA : question.choiceB;
    const phantomsForQuestion: string[] = [];

    for (const seedName of choice.phantomSeeds) {
      const isCoreConviction = CORE_CONVICTION_PHANTOMS.has(seedName);

      try {
        const id = await persistence.createUserPhantom({
          shorthand: seedName,
          feelingSeed: `Creative instinct toward ${seedName.replace(/_/g, ' ')}`,
          phantomStory: `Seeded from taste test: chose '${choice.label}'`,
          influence: seedName.toUpperCase(),
          weight: 3.0 + choice.weightBoost,
          originType: 'seeded',
          isCoreConviction,
          minWeightFloor: isCoreConviction ? MIN_WEIGHT_FLOOR : null,
        });

        if (id) {
          seededIds.push(id);
          phantomsForQuestion.push(id);
        }
      } catch (error) {
        console.error(`[TasteTest] Failed to seed phantom '${seedName}':`, error);
      }
    }

    // Record the taste test result
    try {
      await persistence.recordTasteTestResult({
        userId,
        questionId: answer.questionId,
        choiceALabel: question.choiceA.label,
        choiceBLabel: question.choiceB.label,
        selected: answer.selected,
        phantomsSeeded: phantomsForQuestion,
      });
    } catch (error) {
      console.error(`[TasteTest] Failed to record result for ${answer.questionId}:`, error);
    }
  }

  console.log(
    `[TasteTest] Processed for user ${userId}: ` +
    `${seededIds.length} phantoms seeded from ${answers.length} answers`,
  );

  return seededIds;
}
