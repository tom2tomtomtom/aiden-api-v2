/**
 * Dual-mode (Subjectivity side-by-side) tests.
 *
 * Asserts that when input.dualMode is true:
 *   - The LLM adapter is called twice in parallel
 *   - The first call carries the full system prompt (phantoms + identity)
 *   - The second call carries no system prompt (vanilla)
 *   - Both texts are surfaced on the response
 *   - The vanilla call failing does not break the augmented response
 *
 * When dualMode is false (or unset), no vanilla call is made and the response
 * has no `vanilla` field.
 */
import { describe, it, expect } from 'vitest';
import { processMessage } from '../../src/brain/nuclear-brain.js';
import type { LLMAdapter } from '../../src/brain/llm-adapter.js';
import type { BrainServices } from '../../src/brain/nuclear-brain.js';
import type { Phantom, PhantomPoolProvider } from '../../src/types.js';

interface AdapterCall {
  system?: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
}

function makeMockAdapter(opts: {
  augmentedText?: string;
  vanillaText?: string;
  failVanilla?: boolean;
}) {
  const calls: AdapterCall[] = [];
  let callIndex = 0;
  const mock = {
    primaryConfig: { modelId: 'claude-sonnet-4-6-mock', provider: 'anthropic' as const },
    async generateText(options: AdapterCall) {
      calls.push({
        system: options.system,
        prompt: options.prompt,
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
      });
      const isVanilla = options.system === undefined;
      if (isVanilla && opts.failVanilla) {
        throw new Error('simulated vanilla failure');
      }
      callIndex += 1;
      const text = isVanilla ? opts.vanillaText ?? 'vanilla output' : opts.augmentedText ?? 'augmented output';
      return { text, usage: { promptTokens: 100, completionTokens: 20 } };
    },
  };
  return { adapter: mock as unknown as LLMAdapter, calls };
}

const sampleSystemPhantom: Phantom = {
  shorthand: 'truth→over→ladder',
  origin_context: 'honesty_over_advancement',
  feeling_seed: 'honesty beats career advancement',
  influence: 'TELL THE TRUTH EVEN WHEN IT CLOSES A DOOR',
  weight: 5,
  word_triggers: ['truth', 'honesty'],
  intent_triggers: ['validation_seeking'],
  emotional_contexts: ['professional_pressure'],
  conversation_contexts: ['opening'],
  source: 'hardcoded_system',
};

const mockPool: PhantomPoolProvider = {
  async loadPool() {
    return {
      basePhantoms: new Map([[sampleSystemPhantom.shorthand, sampleSystemPhantom]]),
      agencyPhantoms: [],
      packPhantoms: [],
    };
  },
};

const baseInput = {
  message: 'What is the best line for Dignitas?',
  conversationId: '00000000-0000-0000-0000-000000000000',
  agencyId: '11111111-1111-1111-1111-111111111111',
};

function makeServices(adapter: LLMAdapter): BrainServices {
  return {
    phantomPool: mockPool,
    llmAdapter: adapter,
  };
}

describe('dualMode', () => {
  it('does not call vanilla when dualMode is false', async () => {
    const { adapter, calls } = makeMockAdapter({ augmentedText: 'augmented A' });
    const response = await processMessage(baseInput, makeServices(adapter));
    expect(calls.length).toBe(1);
    expect(calls[0]!.system).toBeDefined();
    expect(response.vanilla).toBeUndefined();
    expect(response.text).toBe('augmented A');
  });

  it('fires a parallel vanilla call when dualMode is true and exposes both texts', async () => {
    const { adapter, calls } = makeMockAdapter({
      augmentedText: 'augmented with phantoms',
      vanillaText: 'plain Sonnet output',
    });

    const response = await processMessage(
      { ...baseInput, dualMode: true, maxOutputTokens: 1600 },
      makeServices(adapter),
    );

    expect(calls.length).toBe(2);
    const augmentedCall = calls.find((c) => c.system !== undefined);
    const vanillaCall = calls.find((c) => c.system === undefined);
    expect(augmentedCall).toBeDefined();
    expect(vanillaCall).toBeDefined();
    // Augmented carries the identity layer.
    expect(augmentedCall!.system).toContain('CORE IDENTITY');
    // Augmented carries phantom context.
    expect(augmentedCall!.system).toContain('truth→over→ladder');
    // Vanilla has no system prompt.
    expect(vanillaCall!.system).toBeUndefined();
    expect(augmentedCall!.maxOutputTokens).toBe(1600);
    expect(vanillaCall!.maxOutputTokens).toBe(1600);
    // Both texts come back on the response.
    expect(response.text).toBe('augmented with phantoms');
    expect(response.vanilla?.text).toBe('plain Sonnet output');
    expect(response.vanilla?.model).toBe('claude-sonnet-4-6-mock');
  });

  it('keeps the augmented response intact when vanilla generation fails', async () => {
    const { adapter, calls } = makeMockAdapter({
      augmentedText: 'augmented still works',
      failVanilla: true,
    });

    const response = await processMessage({ ...baseInput, dualMode: true }, makeServices(adapter));

    expect(calls.length).toBe(2);
    expect(response.text).toBe('augmented still works');
    expect(response.vanilla).toBeUndefined();
  });
});
