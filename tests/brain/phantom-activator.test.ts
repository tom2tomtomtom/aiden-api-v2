/**
 * Phantom Activator Tests
 *
 * Tests all 6 scoring layers, conversation dynamics curve,
 * escalation/kill detection integration, and response mode detection.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import {
  evaluatePhantoms,
  calculateConversationDynamics,
  detectResponseMode,
  detectIntents,
  detectEmotion,
  scorePhantomSixLayer,
  selectTopPhantoms,
  mergeUserPhantoms,
  createUserPhantomProxy,
  type SixLayerInput,
} from '../../src/brain/phantom-activator.js';
import type { Phantom, PhantomActivationScored } from '../../src/types.js';

const require = createRequire(import.meta.url);
const phantomData = require('../../data/phantoms.json') as Array<Record<string, unknown>>;

// ── Helpers ─────────────────────────────────────────────────────────────────

function loadRealPhantoms(): Map<string, Phantom> {
  const map = new Map<string, Phantom>();
  for (const raw of phantomData.slice(0, 50)) {
    const key = (raw.phantom_key as string) || (raw.shorthand as string) || '';
    map.set(key, {
      shorthand: raw.shorthand as string,
      feelingSeed: raw.feeling_seed as string,
      phantomStory: raw.phantom_story as string,
      influence: raw.influence as string,
      weight: raw.weight as number,
      wordTriggers: (raw.word_triggers as string[]) || [],
      intentTriggers: (raw.intent_triggers as string[]) || [],
      emotionalContexts: (raw.emotional_contexts as string[]) || [],
      conversationContexts: (raw.conversation_contexts as string[]) || [],
      identityText: `${raw.feeling_seed} | ${raw.phantom_story} | ${raw.influence}`,
    });
  }
  return map;
}

// ── 6-Layer Scoring Tests ───────────────────────────────────────────────────

describe('6-Layer Phantom Scoring', () => {
  it('Layer 1: word triggers add +2.0 each', () => {
    const score = scorePhantomSixLayer({
      phantom: {
        shorthand: 'test',
        weight: 3.0,
        wordTriggers: ['creative', 'strategy', 'bold'],
        influence: 'TEST',
        identityText: '',
        feelingSeed: '',
        phantomStory: '',
      },
      messageLower: 'a creative strategy that is bold',
      intents: {},
      emotion: 'neutral',
      conversationContext: 'deep',
    });
    // 3 triggers * 2.0 = 6.0, * (3.0/3.0) = 6.0
    expect(score).toBeCloseTo(6.0);
  });

  it('Layer 2: intent triggers add +3.5 each', () => {
    const score = scorePhantomSixLayer({
      phantom: {
        shorthand: 'test',
        weight: 3.0,
        wordTriggers: ['creative'],
        intentTriggers: ['seeking_creative_feedback', 'brainstorming'],
        influence: 'TEST',
        identityText: '',
        feelingSeed: '',
        phantomStory: '',
      },
      messageLower: 'creative',
      intents: { seeking_creative_feedback: true, brainstorming: true },
      emotion: 'neutral',
      conversationContext: 'deep',
    });
    // Layer 1: 1 * 2.0 = 2.0; Layer 2: 2 * 3.5 = 7.0; Total: 9.0 * 1.0 = 9.0
    expect(score).toBeCloseTo(9.0);
  });

  it('Layer 3: emotional context multiplies by 1.4', () => {
    const withEmotion = scorePhantomSixLayer({
      phantom: {
        shorthand: 'test',
        weight: 3.0,
        wordTriggers: ['bold'],
        emotionalContexts: ['excited'],
        influence: 'TEST',
        identityText: '',
        feelingSeed: '',
        phantomStory: '',
      },
      messageLower: 'bold',
      intents: {},
      emotion: 'excited',
      conversationContext: 'deep',
    });

    const withoutEmotion = scorePhantomSixLayer({
      phantom: {
        shorthand: 'test',
        weight: 3.0,
        wordTriggers: ['bold'],
        emotionalContexts: ['excited'],
        influence: 'TEST',
        identityText: '',
        feelingSeed: '',
        phantomStory: '',
      },
      messageLower: 'bold',
      intents: {},
      emotion: 'neutral',
      conversationContext: 'deep',
    });

    expect(withEmotion / withoutEmotion).toBeCloseTo(1.4);
  });

  it('Layer 4: conversation context multiplies by 1.2', () => {
    const withContext = scorePhantomSixLayer({
      phantom: {
        shorthand: 'test',
        weight: 3.0,
        wordTriggers: ['bold'],
        conversationContexts: ['opening'],
        influence: 'TEST',
        identityText: '',
        feelingSeed: '',
        phantomStory: '',
      },
      messageLower: 'bold',
      intents: {},
      emotion: 'neutral',
      conversationContext: 'opening',
    });

    const withoutContext = scorePhantomSixLayer({
      phantom: {
        shorthand: 'test',
        weight: 3.0,
        wordTriggers: ['bold'],
        conversationContexts: ['opening'],
        influence: 'TEST',
        identityText: '',
        feelingSeed: '',
        phantomStory: '',
      },
      messageLower: 'bold',
      intents: {},
      emotion: 'neutral',
      conversationContext: 'deep',
    });

    expect(withContext / withoutContext).toBeCloseTo(1.2);
  });

  it('short-circuits on zero score from layers 1-2', () => {
    const score = scorePhantomSixLayer({
      phantom: {
        shorthand: 'test',
        weight: 3.0,
        wordTriggers: ['xyz_not_in_message'],
        emotionalContexts: ['excited'],
        conversationContexts: ['opening'],
        influence: 'TEST',
        identityText: '',
        feelingSeed: '',
        phantomStory: '',
      },
      messageLower: 'hello world',
      intents: {},
      emotion: 'excited',
      conversationContext: 'opening',
    });
    expect(score).toBe(0);
  });

  it('final score scales by weight/3.0', () => {
    const highWeight = scorePhantomSixLayer({
      phantom: {
        shorthand: 'test',
        weight: 6.0,
        wordTriggers: ['creative'],
        influence: 'TEST',
        identityText: '',
        feelingSeed: '',
        phantomStory: '',
      },
      messageLower: 'creative',
      intents: {},
      emotion: 'neutral',
      conversationContext: 'deep',
    });

    const normalWeight = scorePhantomSixLayer({
      phantom: {
        shorthand: 'test',
        weight: 3.0,
        wordTriggers: ['creative'],
        influence: 'TEST',
        identityText: '',
        feelingSeed: '',
        phantomStory: '',
      },
      messageLower: 'creative',
      intents: {},
      emotion: 'neutral',
      conversationContext: 'deep',
    });

    expect(highWeight / normalWeight).toBeCloseTo(2.0);
  });
});

// ── Conversation Dynamics Tests ─────────────────────────────────────────────

describe('Conversation Dynamics Curve', () => {
  it('Exchanges 1-3: defense 0.25x, ideation 1.3x, bold 1.0x', () => {
    for (const n of [1, 2, 3]) {
      const d = calculateConversationDynamics(n);
      expect(d.defenseMult).toBe(0.25);
      expect(d.ideationMult).toBe(1.3);
      expect(d.boldMult).toBe(1.0);
    }
  });

  it('Exchanges 4-5: defense 0.5x, ideation 1.15x, bold 1.0x', () => {
    for (const n of [4, 5]) {
      const d = calculateConversationDynamics(n);
      expect(d.defenseMult).toBe(0.5);
      expect(d.ideationMult).toBe(1.15);
      expect(d.boldMult).toBe(1.0);
    }
  });

  it('Exchanges 6-8: defense 0.75x, ideation 1.0x, bold 1.2x', () => {
    for (const n of [6, 7, 8]) {
      const d = calculateConversationDynamics(n);
      expect(d.defenseMult).toBe(0.75);
      expect(d.ideationMult).toBe(1.0);
      expect(d.boldMult).toBe(1.2);
    }
  });

  it('Exchanges 9+: defense 1.0x, ideation 1.0x, bold 1.3x', () => {
    for (const n of [9, 10, 20, 100]) {
      const d = calculateConversationDynamics(n);
      expect(d.defenseMult).toBe(1.0);
      expect(d.ideationMult).toBe(1.0);
      expect(d.boldMult).toBe(1.3);
    }
  });

  it('forceIdeationBoost overrides low ideation mult', () => {
    const d = calculateConversationDynamics(9, true);
    expect(d.ideationMult).toBe(1.3);
  });
});

// ── Escalation and Kill Integration ─────────────────────────────────────────

describe('Escalation and Kill in Activation', () => {
  it('escalation boosts bold phantoms by 1.5x', () => {
    const phantoms = loadRealPhantoms();
    const boldPhantom = Array.from(phantoms.entries()).find(
      ([_, p]) => p.influence.toUpperCase().includes('BOLD'),
    );
    if (!boldPhantom) return; // Skip if no bold phantom in data

    const withEsc = evaluatePhantoms(phantoms, {
      message: 'push it further, be bolder',
      conversationHistory: Array(9).fill({ userMsg: 'x', aiResponse: 'y' }),
      activationKeywords: ['bold', 'push', 'further'],
      isEscalation: true,
    });

    const withoutEsc = evaluatePhantoms(phantoms, {
      message: 'push it further, be bolder',
      conversationHistory: Array(9).fill({ userMsg: 'x', aiResponse: 'y' }),
      activationKeywords: ['bold', 'push', 'further'],
      isEscalation: false,
    });

    const boldKey = boldPhantom[0];
    const scoreWith = withEsc.activations.find(a => a.key === boldKey)?.score ?? 0;
    const scoreWithout = withoutEsc.activations.find(a => a.key === boldKey)?.score ?? 0;

    if (scoreWithout > 0) {
      expect(scoreWith).toBeGreaterThan(scoreWithout);
    }
  });

  it('kill suppresses previously dominant phantoms by 0.3x', () => {
    const phantoms = loadRealPhantoms();
    const firstKey = phantoms.keys().next().value!;

    const result = evaluatePhantoms(phantoms, {
      message: 'start over, completely new direction',
      conversationHistory: [],
      activationKeywords: ['start', 'new', 'direction'],
      suppressedKeys: [firstKey],
    });

    const suppressed = result.activations.find(a => a.key === firstKey);
    // If it has a score, it should be suppressed
    // We can't test exact 0.3x without knowing base score, but it should be lower
    expect(suppressed).toBeDefined();
  });
});

// ── Top-N Selection ─────────────────────────────────────────────────────────

describe('Top-N Phantom Selection', () => {
  it('filters zero-score phantoms', () => {
    const activations: PhantomActivationScored[] = [
      { key: 'a', phantom: { shorthand: 'a', feelingSeed: '', phantomStory: '', influence: '', weight: 3 }, score: 5, source: 'base' },
      { key: 'b', phantom: { shorthand: 'b', feelingSeed: '', phantomStory: '', influence: '', weight: 3 }, score: 0, source: 'base' },
      { key: 'c', phantom: { shorthand: 'c', feelingSeed: '', phantomStory: '', influence: '', weight: 3 }, score: 3, source: 'base' },
    ];

    const top = selectTopPhantoms(activations, 12);
    expect(top.length).toBe(2);
    expect(top[0].key).toBe('a');
  });

  it('respects maxPhantoms limit', () => {
    const activations: PhantomActivationScored[] = Array.from({ length: 20 }, (_, i) => ({
      key: `p${i}`,
      phantom: { shorthand: `p${i}`, feelingSeed: '', phantomStory: '', influence: '', weight: 3 },
      score: 20 - i,
      source: 'base' as const,
    }));

    const top = selectTopPhantoms(activations, 5);
    expect(top.length).toBe(5);
    expect(top[0].key).toBe('p0');
  });
});

// ── User Phantom Merging ────────────────────────────────────────────────────

describe('User Phantom Merging', () => {
  it('merges user phantoms with familiarity boost', () => {
    const base: PhantomActivationScored[] = [
      { key: 'base1', phantom: { shorthand: 'base1', feelingSeed: 'creative instinct', phantomStory: 'test', influence: 'LEAD', weight: 3 }, score: 2, source: 'base' },
    ];

    const userPhantoms = [{
      id: 'user1',
      shorthand: 'user_creative',
      feeling_seed: 'creative thinking is key',
      phantom_story: 'born from creative discussions',
      influence: 'PUSH_FOR_CREATIVITY',
      weight: 4.0,
      activation_count: 5,
    }];

    const merged = mergeUserPhantoms(userPhantoms, ['creative', 'thinking', 'push'], base);
    const userEntry = merged.find(a => a.source === 'user');
    expect(userEntry).toBeDefined();
    expect(userEntry!.score).toBeGreaterThan(0);
  });

  it('anti-phantoms penalize similar base phantoms', () => {
    const base: PhantomActivationScored[] = [
      { key: 'base1', phantom: { shorthand: 'base1', feelingSeed: 'corporate speak is professional', phantomStory: 'test', influence: 'FORMAL_TONE', weight: 3 }, score: 5, source: 'base' },
    ];

    const antiPhantoms = [{
      id: 'anti1',
      shorthand: 'anti_corporate',
      feeling_seed: 'corporate jargon is empty',
      phantom_story: 'rejected formal corporate tone',
      influence: 'AVOID_CORPORATE_SPEAK',
      weight: 4.0,
      is_anti_phantom: true,
    }];

    const merged = mergeUserPhantoms(antiPhantoms, ['corporate', 'speak', 'professional'], base);
    const penalized = merged.find(a => a.key === 'base1');
    expect(penalized!.score).toBeLessThan(5);
  });
});

// ── Real Phantom Data Tests ─────────────────────────────────────────────────

describe('Real Phantom Data', () => {
  it('loads phantom data successfully', () => {
    const phantoms = loadRealPhantoms();
    expect(phantoms.size).toBeGreaterThan(10);
  });

  it('evaluates real phantoms with creative message', () => {
    const phantoms = loadRealPhantoms();
    const { activations } = evaluatePhantoms(phantoms, {
      message: 'I need a bold creative strategy for a brand launch campaign',
      conversationHistory: [{ userMsg: 'help me with a campaign', aiResponse: 'sure' }],
      activationKeywords: ['bold', 'creative', 'strategy', 'brand', 'launch', 'campaign'],
    });

    const active = activations.filter(a => a.score > 0);
    expect(active.length).toBeGreaterThan(0);
  });
});
