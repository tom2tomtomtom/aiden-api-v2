import { describe, expect, it, vi } from 'vitest';
import { processMessageStream, type BrainServices } from '../../src/brain/nuclear-brain.js';
import type { LLMAdapter } from '../../src/brain/llm-adapter.js';
import type { MessageAnalysis, PhantomPoolProvider } from '../../src/types.js';

const analysis: MessageAnalysis = {
  energy: 'medium',
  momentum: 'converging',
  emotion: 'focused',
  intent: 'collaborative_building',
  challengeOpportunity: null,
  claimsToVerify: [],
  temperatureAdjustment: 0,
  searchSuppressed: true,
  suppressionReason: 'creative task',
  activationKeywords: ['idea'],
  escalationDetected: false,
  queryMode: 'generative',
};

const phantomPool: PhantomPoolProvider = {
  async loadPool() {
    return {
      basePhantoms: new Map(),
      agencyPhantoms: [],
      packPhantoms: [],
    };
  },
};

const input = {
  message: 'Give me one territory and one idea.',
  conversationId: '00000000-0000-0000-0000-000000000000',
  agencyId: '11111111-1111-1111-1111-111111111111',
  entropy: 0,
  entropySeed: 7,
};

function services(adapter: LLMAdapter, onResponse = vi.fn(async () => {})): BrainServices {
  return {
    phantomPool,
    haikuAnalyzer: { analyzeMessage: vi.fn().mockResolvedValue(analysis) } as never,
    llmAdapter: adapter,
    onResponse,
  };
}

describe('processMessageStream', () => {
  it('passes the request-scoped output-token cap to the provider stream', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapter = {
      primaryConfig: { provider: 'anthropic', modelId: 'mock-sonnet' },
      generateText: vi.fn(() => {
        throw new Error('streaming must not call the buffered adapter path');
      }),
      async *streamText(options: Record<string, unknown>) {
        calls.push(options);
        yield '{"client_reply":"One idea."}';
        return { text: '{"client_reply":"One idea."}' };
      },
    } as unknown as LLMAdapter;

    const stream = processMessageStream(
      { ...input, maxOutputTokens: 1600 },
      services(adapter),
    );
    while (!(await stream.next()).done) {
      // Drain the single provider response.
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]?.maxOutputTokens).toBe(1600);
  });

  it('yields the first provider delta before the provider finishes', async () => {
    let releaseSecond!: () => void;
    const secondAllowed = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const calls: Array<Record<string, unknown>> = [];
    const onResponse = vi.fn(async () => {});
    const adapter = {
      primaryConfig: { provider: 'anthropic', modelId: 'mock-sonnet' },
      generateText: vi.fn(() => {
        throw new Error('streaming must not call the buffered adapter path');
      }),
      async *streamText(options: Record<string, unknown>) {
        calls.push(options);
        yield '{"client_reply":"The Window';
        await secondAllowed;
        yield '. One unbroken view."}';
        return {
          text: '{"client_reply":"The Window. One unbroken view."}',
          citations: [{ index: 1, url: 'https://example.com', title: 'Example' }],
          usage: { promptTokens: 10, completionTokens: 8 },
        };
      },
    } as unknown as LLMAdapter;

    const stream = processMessageStream(input, services(adapter, onResponse));
    const first = await stream.next();

    expect(first).toEqual({ value: '{"client_reply":"The Window', done: false });
    expect(onResponse).not.toHaveBeenCalled();
    expect(calls[0]?.webSearch).toBe(false);

    releaseSecond();
    expect(await stream.next()).toEqual({ value: '. One unbroken view."}', done: false });
    const finished = await stream.next();

    expect(finished.done).toBe(true);
    expect(finished.value.analysis).toEqual(analysis);
    expect(finished.value.entropySeed).toBe(7);
    expect(finished.value.citations).toEqual([
      { index: 1, url: 'https://example.com', title: 'Example' },
    ]);
    expect(onResponse).toHaveBeenCalledTimes(1);
    expect(onResponse.mock.calls[0]?.[0].aiResponse).toBe(
      '{"client_reply":"The Window. One unbroken view."}',
    );
  });

  it('does not run post-response work when the provider stream fails', async () => {
    const onResponse = vi.fn(async () => {});
    const adapter = {
      primaryConfig: { provider: 'anthropic', modelId: 'mock-sonnet' },
      generateText: vi.fn(() => {
        throw new Error('streaming must not call the buffered adapter path');
      }),
      async *streamText() {
        yield 'partial';
        throw new Error('provider stream broke');
      },
    } as unknown as LLMAdapter;

    const stream = processMessageStream(input, services(adapter, onResponse));
    expect(await stream.next()).toEqual({ value: 'partial', done: false });
    await expect(stream.next()).rejects.toThrow('provider stream broke');
    expect(onResponse).not.toHaveBeenCalled();
  });
});
