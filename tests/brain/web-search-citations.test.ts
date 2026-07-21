import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const anthropicCreateMock = vi.hoisted(() => vi.fn());
const anthropicConstructorMock = vi.hoisted(() =>
  vi.fn(() => ({
    messages: {
      create: anthropicCreateMock,
    },
  })),
);

vi.mock('@anthropic-ai/sdk', () => ({
  default: anthropicConstructorMock,
}));

const originalEnv = { ...process.env };

function apiResponse(overrides: Record<string, unknown>) {
  return {
    content: [],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 },
    ...overrides,
  };
}

describe('LLMAdapter web search + citations', () => {
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

  it('attaches the web_search server tool only when webSearch is set', async () => {
    anthropicCreateMock.mockResolvedValue(
      apiResponse({ content: [{ type: 'text', text: 'hi', citations: null }] }),
    );
    const adapter = await makeAdapter();

    await adapter.generateText({ prompt: 'no search' });
    expect(anthropicCreateMock.mock.calls[0][0].tools).toBeUndefined();

    await adapter.generateText({ prompt: 'with search', webSearch: true });
    expect(anthropicCreateMock.mock.calls[1][0].tools).toEqual([
      { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
    ]);
  });

  it('extracts deduped citations and appends inline markers after cited spans', async () => {
    const citation = (url: string, title: string, cited: string) => ({
      type: 'web_search_result_location',
      url,
      title,
      cited_text: cited,
      encrypted_index: 'x',
    });
    anthropicCreateMock.mockResolvedValue(
      apiResponse({
        content: [
          { type: 'text', text: 'Market grew 12% in 2025.', citations: [citation('https://a.example/report', 'A Report', 'grew 12%')] },
          { type: 'text', text: ' Retention rose too.', citations: [citation('https://b.example/study', 'B Study', 'retention rose'), citation('https://a.example/report', 'A Report', 'grew 12%')] },
          { type: 'text', text: ' Uncited closing thought.', citations: null },
        ],
      }),
    );
    const adapter = await makeAdapter();
    const result = await adapter.generateText({ prompt: 'stats', webSearch: true });

    expect(result.text).toBe(
      'Market grew 12% in 2025. [[1]](https://a.example/report) Retention rose too. [[2]](https://b.example/study) [[1]](https://a.example/report) Uncited closing thought.',
    );
    expect(result.citations).toEqual([
      { index: 1, url: 'https://a.example/report', title: 'A Report', cited_text: 'grew 12%' },
      { index: 2, url: 'https://b.example/study', title: 'B Study', cited_text: 'retention rose' },
    ]);
  });

  it('continues after pause_turn by echoing assistant content, and accumulates usage', async () => {
    const pausedContent = [{ type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'q' } }];
    anthropicCreateMock
      .mockResolvedValueOnce(apiResponse({ content: pausedContent, stop_reason: 'pause_turn' }))
      .mockResolvedValueOnce(
        apiResponse({ content: [{ type: 'text', text: 'done', citations: null }], usage: { input_tokens: 5, output_tokens: 7 } }),
      );
    const adapter = await makeAdapter();
    const result = await adapter.generateText({
      prompt: 'long search',
      webSearch: true,
      maxOutputTokens: 30,
    });

    expect(anthropicCreateMock).toHaveBeenCalledTimes(2);
    expect(anthropicCreateMock.mock.calls[0][0].max_tokens).toBe(30);
    expect(anthropicCreateMock.mock.calls[1][0].max_tokens).toBe(10);
    const secondCallMessages = anthropicCreateMock.mock.calls[1][0].messages;
    expect(secondCallMessages[secondCallMessages.length - 1]).toEqual({
      role: 'assistant',
      content: pausedContent,
    });
    expect(result.text).toBe('done');
    expect(result.usage).toEqual({ promptTokens: 15, completionTokens: 27 });
  });

  it('does not continue after a pause_turn exhausts the output budget', async () => {
    anthropicCreateMock.mockResolvedValue(apiResponse({
      content: [{ type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'q' } }],
      stop_reason: 'pause_turn',
      usage: { input_tokens: 10, output_tokens: 30 },
    }));
    const adapter = await makeAdapter();

    const result = await adapter.generateText({
      prompt: 'long search',
      webSearch: true,
      maxOutputTokens: 30,
    });

    expect(anthropicCreateMock).toHaveBeenCalledTimes(1);
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 30 });
  });

  it('omits citations from the result when nothing was cited', async () => {
    anthropicCreateMock.mockResolvedValue(
      apiResponse({ content: [{ type: 'text', text: 'plain answer', citations: null }] }),
    );
    const adapter = await makeAdapter();
    const result = await adapter.generateText({ prompt: 'plain', webSearch: true });
    expect(result.citations).toBeUndefined();
  });
});
