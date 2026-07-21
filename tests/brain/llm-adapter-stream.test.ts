import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const anthropicStreamMock = vi.hoisted(() => vi.fn());
const anthropicConstructorMock = vi.hoisted(() =>
  vi.fn(() => ({
    messages: {
      stream: anthropicStreamMock,
    },
  })),
);

vi.mock('@anthropic-ai/sdk', () => ({
  default: anthropicConstructorMock,
}));

const originalEnv = { ...process.env };

function message(overrides: Record<string, unknown> = {}) {
  return {
    content: [{ type: 'text', text: 'first second', citations: null }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 4 },
    ...overrides,
  };
}

function providerStream(events: Array<Record<string, unknown>>, final: Record<string, unknown>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
    finalMessage: vi.fn().mockResolvedValue(final),
  };
}

describe('LLMAdapter.streamText', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.AIDEN_LLM_PROVIDER = 'anthropic';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function makeAdapter() {
    const { LLMAdapter } = await import('../../src/brain/llm-adapter.js');
    return new LLMAdapter({ provider: 'anthropic', modelId: 'claude-sonnet-4-6' });
  }

  it('yields provider deltas and returns final text, usage, citations, and search config', async () => {
    const citation = {
      type: 'web_search_result_location',
      url: 'https://example.com/source',
      title: 'Source',
      cited_text: 'first',
      encrypted_index: 'x',
    };
    anthropicStreamMock.mockReturnValue(providerStream(
      [
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'first' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'citations_delta', citation } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: ' second' } },
        { type: 'content_block_stop', index: 1 },
      ],
      message({
        content: [
          { type: 'text', text: 'first', citations: [citation] },
          { type: 'text', text: ' second', citations: null },
        ],
      }),
    ));
    const adapter = await makeAdapter();
    const stream = (adapter.streamText as any)({
      prompt: 'Find the fact',
      messages: [{ role: 'user', content: 'Find the fact' }],
      webSearch: true,
    });

    expect(await stream.next()).toEqual({ value: 'first', done: false });
    expect(await stream.next()).toEqual({
      value: ' [[1]](https://example.com/source)',
      done: false,
    });
    expect(await stream.next()).toEqual({ value: ' second', done: false });
    const finished = await stream.next();

    expect(finished.done).toBe(true);
    expect(finished.value).toEqual({
      text: 'first [[1]](https://example.com/source) second',
      citations: [
        {
          index: 1,
          url: 'https://example.com/source',
          title: 'Source',
          cited_text: 'first',
        },
      ],
      usage: { promptTokens: 10, completionTokens: 4 },
    });
    expect(anthropicStreamMock.mock.calls[0]?.[0].tools).toEqual([
      { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
    ]);
  });

  it('continues pause_turn streams and aggregates usage', async () => {
    const pausedContent = [
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'q' } },
    ];
    anthropicStreamMock
      .mockReturnValueOnce(providerStream([], message({
        content: pausedContent,
        stop_reason: 'pause_turn',
        usage: { input_tokens: 10, output_tokens: 20 },
      })))
      .mockReturnValueOnce(providerStream(
        [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } }],
        message({
          content: [{ type: 'text', text: 'done', citations: null }],
          usage: { input_tokens: 5, output_tokens: 7 },
        }),
      ));
    const adapter = await makeAdapter();
    const stream = (adapter.streamText as any)({
      prompt: 'Search',
      messages: [{ role: 'user', content: 'Search' }],
      webSearch: true,
      maxOutputTokens: 30,
    });

    expect(await stream.next()).toEqual({ value: 'done', done: false });
    const finished = await stream.next();

    expect(finished.value.text).toBe('done');
    expect(finished.value.usage).toEqual({ promptTokens: 15, completionTokens: 27 });
    expect(anthropicStreamMock).toHaveBeenCalledTimes(2);
    expect(anthropicStreamMock.mock.calls[0]?.[0].max_tokens).toBe(30);
    expect(anthropicStreamMock.mock.calls[1]?.[0].max_tokens).toBe(10);
    const secondMessages = anthropicStreamMock.mock.calls[1]?.[0].messages;
    expect(secondMessages[secondMessages.length - 1]).toEqual({
      role: 'assistant',
      content: pausedContent,
    });
  });

  it('does not continue after a pause_turn exhausts the output budget', async () => {
    anthropicStreamMock.mockReturnValue(providerStream([], message({
      content: [{ type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'q' } }],
      stop_reason: 'pause_turn',
      usage: { input_tokens: 10, output_tokens: 30 },
    })));
    const adapter = await makeAdapter();
    const stream = (adapter.streamText as any)({
      prompt: 'Search',
      messages: [{ role: 'user', content: 'Search' }],
      webSearch: true,
      maxOutputTokens: 30,
    });

    const finished = await stream.next();

    expect(finished.done).toBe(true);
    expect(finished.value.usage.completionTokens).toBe(30);
    expect(anthropicStreamMock).toHaveBeenCalledTimes(1);
  });
});
