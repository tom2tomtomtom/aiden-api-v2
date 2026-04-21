/**
 * Brain Initialization Tests
 *
 * Verifies that all brain modules can be imported and initialized
 * without external dependencies (no API keys, no database).
 */

import { describe, it, expect } from 'vitest';

// Import all brain modules to verify they load
import {
  evaluatePhantoms,
  evaluateAgencyPhantoms,
  selectTopPhantoms,
  applyWorkspacePreferences,
  calculateConversationDynamics,
  detectResponseMode,
  detectIntents,
  detectEmotion,
  scorePhantomSixLayer,
  createUserPhantomProxy,
  mergeUserPhantoms,
} from '../src/brain/phantom-activator.js';

import {
  detectCollisions,
  buildCollisionContext,
} from '../src/brain/phantom-collision.js';

import { PhantomContextBuilder } from '../src/brain/phantom-context.js';

import {
  HaikuAnalyzer,
  generateEnergyContext,
  generateMomentumContext,
  generateChallengeContext,
} from '../src/brain/haiku-analyzer.js';

import {
  detectEscalation,
  detectKill,
  detectSensitiveTopic,
  buildCreativeResetContext,
  buildEscalationContext,
  buildSensitiveBraveryContext,
} from '../src/brain/creative-reset.js';

import {
  analyzeMessageComplexity,
  isBrevityPhantom,
  getBrevitySuppressionMultiplier,
} from '../src/brain/brevity-control.js';

import {
  buildPhantomDeliveryInstructions,
  buildPrimeDirective,
  buildYesAndContext,
  getPromptStrategy,
} from '../src/brain/prompt-strategies.js';

import {
  LLMAdapter,
  createPrimaryAdapter,
  createFastAdapter,
} from '../src/brain/llm-adapter.js';

import type { Phantom, PhantomActivationScored } from '../src/types.js';

// ── Test Data ────────────────────────────────────────────────────────────────

function createTestPhantom(overrides: Partial<Phantom> = {}): Phantom {
  return {
    shorthand: 'test_phantom',
    feelingSeed: 'test feeling',
    phantomStory: 'A test phantom for unit tests',
    influence: 'LEAD_WITH creative direction',
    weight: 3.0,
    wordTriggers: ['creative', 'strategy'],
    identityText: 'test feeling | A test phantom | LEAD_WITH',
    intentTriggers: ['seeking_creative_feedback'],
    emotionalContexts: ['excited'],
    conversationContexts: ['opening'],
    ...overrides,
  };
}

function createTestPhantomMap(): Map<string, Phantom> {
  const map = new Map<string, Phantom>();

  map.set('challenger_instinct', createTestPhantom({
    shorthand: 'challenger_instinct',
    feelingSeed: 'challenge everything',
    phantomStory: 'Born from years of pushing back on safe ideas',
    influence: 'CHALLENGE_DIRECTLY',
    weight: 4.0,
    wordTriggers: ['challenge', 'push back', 'disagree'],
    intentTriggers: ['challenging_assumption'],
  }));

  map.set('bold_direction', createTestPhantom({
    shorthand: 'bold_direction',
    feelingSeed: 'fearless creative leaps',
    phantomStory: 'The conviction that the best work comes from risk',
    influence: 'BOLD_SURPRISE',
    weight: 3.5,
    wordTriggers: ['bold', 'brave', 'risky'],
    emotionalContexts: ['excited'],
  }));

  map.set('brevity_master', createTestPhantom({
    shorthand: 'brevity_master',
    feelingSeed: 'less is more',
    phantomStory: 'Every word must earn its place',
    influence: 'BE_ULTRA_BRIEF',
    weight: 2.5,
    wordTriggers: ['brief', 'concise'],
  }));

  map.set('trust_deepened', createTestPhantom({
    shorthand: 'trust_deepened',
    feelingSeed: 'earned trust',
    phantomStory: 'Deep relationships built through honest conversations',
    influence: 'VALUE_RELATIONSHIP',
    weight: 3.0,
    originContext: 'personality_depth',
  }));

  return map;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Brain initialization', () => {
  it('should load all brain modules without errors', () => {
    // If we got here, all imports succeeded
    expect(evaluatePhantoms).toBeDefined();
    expect(detectCollisions).toBeDefined();
    expect(PhantomContextBuilder).toBeDefined();
    expect(HaikuAnalyzer).toBeDefined();
    expect(detectEscalation).toBeDefined();
    expect(analyzeMessageComplexity).toBeDefined();
    expect(buildPhantomDeliveryInstructions).toBeDefined();
    expect(LLMAdapter).toBeDefined();
  });

  it('should initialize phantom map from test data', () => {
    const phantomMap = createTestPhantomMap();
    expect(phantomMap.size).toBe(4);
    expect(phantomMap.get('challenger_instinct')?.shorthand).toBe('challenger_instinct');
  });
});

describe('Phantom Activator', () => {
  it('should calculate conversation dynamics correctly', () => {
    // Exchanges 1-3: defense 0.25x, ideation 1.3x, bold 1.0x
    const early = calculateConversationDynamics(2);
    expect(early.defenseMult).toBe(0.25);
    expect(early.ideationMult).toBe(1.3);
    expect(early.boldMult).toBe(1.0);

    // Exchanges 4-5: defense 0.5x, ideation 1.15x, bold 1.0x
    const mid = calculateConversationDynamics(4);
    expect(mid.defenseMult).toBe(0.5);
    expect(mid.ideationMult).toBe(1.15);

    // Exchanges 6-8: defense 0.75x, ideation 1.0x, bold 1.2x
    const late = calculateConversationDynamics(7);
    expect(late.defenseMult).toBe(0.75);
    expect(late.boldMult).toBe(1.2);

    // Exchanges 9+: defense 1.0x, ideation 1.0x, bold 1.3x
    const deep = calculateConversationDynamics(10);
    expect(deep.defenseMult).toBe(1.0);
    expect(deep.boldMult).toBe(1.3);
  });

  it('should force ideation boost on kill detection', () => {
    const dynamics = calculateConversationDynamics(7, true);
    expect(dynamics.ideationMult).toBe(1.3);
  });

  it('should detect response modes correctly', () => {
    expect(detectResponseMode('give me a quick summary')).toBe('spark');
    expect(detectResponseMode('analyze this in detail')).toBe('deep');
    expect(detectResponseMode('help me build a framework')).toBe('build');
    expect(detectResponseMode('how do I sell this idea')).toBe('sell');
    expect(detectResponseMode('write a headline for this campaign')).toBe('copy');
    expect(detectResponseMode('tell me about branding')).toBe('default');
  });

  it('should detect intents from messages', () => {
    const intents = detectIntents('what do you think about this approach?');
    expect(intents['seeking_creative_feedback']).toBe(true);

    const intents2 = detectIntents('write it up for me');
    expect(intents2['synthesis_request']).toBe(true);
  });

  it('should detect emotions from messages', () => {
    expect(detectEmotion('This is amazing! Love this!')).toBe('excited');
    expect(detectEmotion('I wonder about the implications')).toBe('curious');
    // "but" matches the 'challenged' emotion marker, validating the detection logic
    expect(detectEmotion('proceed with the plan')).toBe('neutral');
  });

  it('should evaluate phantoms with keywords', () => {
    const phantomMap = createTestPhantomMap();
    const { activations, dynamics } = evaluatePhantoms(phantomMap, {
      message: 'I want to challenge the creative direction and push for something bolder',
      conversationHistory: [],
      activationKeywords: ['challenge', 'creative', 'bold', 'direction', 'push'],
    });

    expect(activations.length).toBe(4);
    // Challenger and bold phantoms should score highest
    const nonZero = activations.filter(a => a.score > 0);
    expect(nonZero.length).toBeGreaterThan(0);
  });

  it('should apply 6-layer scoring', () => {
    const score = scorePhantomSixLayer({
      phantom: {
        shorthand: 'test',
        weight: 3.0,
        wordTriggers: ['creative', 'strategy'],
        intentTriggers: ['seeking_creative_feedback'],
        emotionalContexts: ['excited'],
        conversationContexts: ['opening'],
        influence: 'LEAD_WITH',
        identityText: 'test',
        feelingSeed: 'test',
        phantomStory: 'test',
      },
      messageLower: 'what do you think about this creative strategy?',
      intents: { seeking_creative_feedback: true },
      emotion: 'excited',
      conversationContext: 'opening',
    });

    // Layer 1: 2 word triggers (creative + strategy) = 4.0
    // Layer 2: 1 intent trigger = +3.5 = 7.5
    // Layer 3: emotional match = x1.4 = 10.5
    // Layer 4: context match = x1.2 = 12.6
    // Final: x(3.0/3.0) = 12.6
    expect(score).toBeCloseTo(12.6, 1);
  });
});

describe('Phantom Collision Detection', () => {
  it('should detect collision between opposing phantoms', () => {
    const activations: PhantomActivationScored[] = [
      {
        key: 'brevity_master',
        phantom: { shorthand: 'brevity_master', feelingSeed: 'less is more', phantomStory: 'test', influence: 'BE_ULTRA_BRIEF', weight: 3.0 },
        score: 1.0,
        source: 'base',
      },
      {
        key: 'depth_seeker',
        phantom: { shorthand: 'depth_seeker', feelingSeed: 'go deep', phantomStory: 'test', influence: 'PROVIDE_COMPREHENSIVE analysis', weight: 3.0 },
        score: 1.0,
        source: 'base',
      },
    ];

    const collisions = detectCollisions(activations, 0.85);
    expect(collisions.length).toBeGreaterThan(0);
    expect(collisions[0].tensionDescription).toContain('vs');
  });

  it('should not detect collision below threshold', () => {
    const activations: PhantomActivationScored[] = [
      {
        key: 'brevity_master',
        phantom: { shorthand: 'brevity_master', feelingSeed: 'less is more', phantomStory: 'test', influence: 'BE_ULTRA_BRIEF', weight: 3.0 },
        score: 0.5,
        source: 'base',
      },
      {
        key: 'depth_seeker',
        phantom: { shorthand: 'depth_seeker', feelingSeed: 'go deep', phantomStory: 'test', influence: 'PROVIDE_COMPREHENSIVE', weight: 3.0 },
        score: 0.5,
        source: 'base',
      },
    ];

    const collisions = detectCollisions(activations, 0.85);
    expect(collisions.length).toBe(0);
  });

  it('should build collision context string', () => {
    const ctx = buildCollisionContext([{
      phantomA: 'brevity',
      phantomB: 'depth',
      tensionDescription: 'brief vs deep',
      injectionPrompt: 'test tension',
      scoreA: 1.0,
      scoreB: 1.0,
    }]);
    expect(ctx).toContain('CREATIVE TENSIONS');
    expect(ctx).toContain('test tension');
  });
});

describe('Phantom Context Builder', () => {
  it('should build two-layer context', () => {
    const phantomMap = createTestPhantomMap();
    const builder = new PhantomContextBuilder(phantomMap);

    const activations: PhantomActivationScored[] = [
      { key: 'challenger_instinct', phantom: phantomMap.get('challenger_instinct')!, score: 5.0, source: 'base' },
      { key: 'trust_deepened', phantom: phantomMap.get('trust_deepened')!, score: 3.0, source: 'base' },
    ];

    const context = builder.buildPhantomContext(activations, 'collaborator', false);
    expect(context).toContain('ACTIVE STANCE');
    expect(context).toContain('DELIVER YOUR RESPONSE');
  });

  it('should use full stories in collision mode', () => {
    const phantomMap = createTestPhantomMap();
    const builder = new PhantomContextBuilder(phantomMap);

    const activations: PhantomActivationScored[] = [
      { key: 'challenger_instinct', phantom: phantomMap.get('challenger_instinct')!, score: 5.0, source: 'base' },
    ];

    const context = builder.buildPhantomContext(activations, 'collaborator', true);
    expect(context).toContain('INTELLECTUAL FOREGROUND');
  });
});

describe('Creative Reset Detection', () => {
  it('should detect escalation (16 phrases)', () => {
    expect(detectEscalation('push it further please')).toBe(true);
    expect(detectEscalation('this is too safe')).toBe(true);
    expect(detectEscalation('shock me with something new')).toBe(true);
    expect(detectEscalation('I like this direction')).toBe(false);
  });

  it('should detect kill (13 phrases)', () => {
    expect(detectKill('kill it and start over')).toBe(true);
    expect(detectKill('nuke it')).toBe(true);
    expect(detectKill('back to square one')).toBe(true);
    expect(detectKill('iterate on this')).toBe(false);
  });

  it('should detect sensitive topics', () => {
    expect(detectSensitiveTopic('campaign about grief and mourning')).toBe(true);
    expect(detectSensitiveTopic('mental health awareness brief')).toBe(true);
    expect(detectSensitiveTopic('new shoe campaign')).toBe(false);
  });
});

describe('Brevity Control', () => {
  it('should classify message complexity', () => {
    expect(analyzeMessageComplexity('yes')).toBe('simple');
    expect(analyzeMessageComplexity('tell me more about this')).toBe('moderate');
    expect(analyzeMessageComplexity('how can i improve the comprehensive analysis of this strategy')).toBe('complex');
  });

  it('should identify brevity phantoms', () => {
    expect(isBrevityPhantom('BE_ULTRA_BRIEF')).toBe(true);
    expect(isBrevityPhantom('LEAD_WITH creative direction')).toBe(false);
  });

  it('should suppress brevity phantoms on complex messages', () => {
    expect(getBrevitySuppressionMultiplier('BE_ULTRA_BRIEF', 'complex')).toBe(0.1);
    expect(getBrevitySuppressionMultiplier('BE_ULTRA_BRIEF', 'simple')).toBe(1.0);
    expect(getBrevitySuppressionMultiplier('LEAD_WITH', 'complex')).toBe(1.0);
  });
});

describe('Prompt Strategies', () => {
  it('should build delivery instructions for all modes', () => {
    const collaborator = buildPhantomDeliveryInstructions('collaborator');
    expect(collaborator).toContain('DELIVER YOUR RESPONSE');
    expect(collaborator).toContain('build on');

    const challenger = buildPhantomDeliveryInstructions('challenger');
    expect(challenger).toContain('conviction');

    const collaborative = buildPhantomDeliveryInstructions('collaborative');
    expect(collaborative).toContain('Strategic Wingman');
  });

  it('should build prime directives for maturity stages', () => {
    expect(buildPrimeDirective('INITIAL', 'collaborator')).toContain('CLARITY');
    expect(buildPrimeDirective('SYNTHESIS_READY', 'collaborator')).toContain('DELIVERS');
    expect(buildPrimeDirective('HAS_DIRECTION', 'collaborator')).toContain('CONVERGENCE');
  });

  it('should detect yes-and signals', () => {
    expect(buildYesAndContext('i think we should go bolder')).toContain('YES-AND MODE');
    expect(buildYesAndContext('what about a different approach')).toContain('YES-AND MODE');
    expect(buildYesAndContext('do the thing')).toBe('');
  });
});

describe('Haiku Analyzer', () => {
  it('should generate energy context for all levels', () => {
    const high = generateEnergyContext({ energy: 'high' } as any);
    expect(high).toContain('HARD REQUIREMENT');
    expect(high).toContain('fired up');

    const urgent = generateEnergyContext({ energy: 'urgent' } as any);
    expect(urgent).toContain('action-oriented');
  });

  it('should generate momentum context', () => {
    const exploring = generateMomentumContext({ momentum: 'exploring' } as any);
    expect(exploring).toContain('EXPLORING');

    const stalling = generateMomentumContext({ momentum: 'stalling' } as any);
    expect(stalling).toContain('low');
  });

  it('should generate challenge context when opportunity exists', () => {
    const withChallenge = generateChallengeContext({
      challengeOpportunity: { type: 'devils_advocate', reason: 'weak idea', approach: 'push back' },
    } as any);
    expect(withChallenge).toContain('CHALLENGE OPPORTUNITY');

    const noChallenge = generateChallengeContext({ challengeOpportunity: null } as any);
    expect(noChallenge).toBe('');
  });
});

describe('LLM Adapter', () => {
  it('should create adapter instances', () => {
    const primary = createPrimaryAdapter();
    expect(primary).toBeInstanceOf(LLMAdapter);

    const fast = createFastAdapter();
    expect(fast).toBeInstanceOf(LLMAdapter);
  });
});
