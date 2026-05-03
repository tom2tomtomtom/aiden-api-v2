import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateTextMock = vi.hoisted(() => vi.fn());
const streamTextMock = vi.hoisted(() => vi.fn());
const openAIModelMock = vi.hoisted(() => vi.fn((modelId: string) => ({ provider: 'openai', modelId })));
const createOpenAIMock = vi.hoisted(() => vi.fn(() => openAIModelMock));

vi.mock('ai', () => ({
  generateText: generateTextMock,
  streamText: streamTextMock,
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: createOpenAIMock,
}));

const originalEnv = { ...process.env };

describe('LLMAdapter OpenAI provider', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.AIDEN_LLM_PROVIDER = 'openai';
    process.env.OPENAI_MODEL = 'gpt-5.4';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('routes direct generation through the OpenAI provider', async () => {
    generateTextMock.mockResolvedValue({
      text: 'OpenAI response',
      usage: { promptTokens: 11, completionTokens: 7 },
    });

    const { LLMAdapter } = await import('../../src/brain/llm-adapter.js');
    const adapter = new LLMAdapter({
      provider: 'openai',
      modelId: 'gpt-5.4',
      maxOutputTokens: 123,
      temperature: 0.4,
    });

    const result = await adapter.generateText({
      system: 'You are a creative director.',
      prompt: 'Judge this idea.',
    });

    expect(createOpenAIMock).toHaveBeenCalledWith({ apiKey: 'test-openai-key' });
    expect(openAIModelMock).toHaveBeenCalledWith('gpt-5.4');
    expect(generateTextMock).toHaveBeenCalledWith(expect.objectContaining({
      model: { provider: 'openai', modelId: 'gpt-5.4' },
      system: 'You are a creative director.',
      prompt: 'Judge this idea.',
      maxTokens: 123,
      temperature: 0.4,
    }));
    expect(result).toEqual({
      text: 'OpenAI response',
      usage: { promptTokens: 11, completionTokens: 7 },
    });
  });

  it('uses OpenAI for the primary adapter when configured by environment', async () => {
    generateTextMock.mockResolvedValue({
      text: 'Primary OpenAI response',
      usage: { promptTokens: 5, completionTokens: 3 },
    });

    const { createPrimaryAdapter } = await import('../../src/brain/llm-adapter.js');
    const adapter = createPrimaryAdapter();

    await adapter.generateText({ prompt: 'Build a territory.' });

    expect(openAIModelMock).toHaveBeenCalledWith('gpt-5.4');
    expect(generateTextMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Build a territory.',
    }));
  });

  it('streams text through OpenAI when the adapter is configured for OpenAI', async () => {
    async function* chunks() {
      yield 'Sharp ';
      yield 'strategy';
    }

    streamTextMock.mockReturnValue({ textStream: chunks() });

    const { LLMAdapter } = await import('../../src/brain/llm-adapter.js');
    const adapter = new LLMAdapter({
      provider: 'openai',
      modelId: 'gpt-5.4',
      maxOutputTokens: 321,
      temperature: 0.2,
    });

    const streamed: string[] = [];
    for await (const chunk of adapter.streamText({
      system: 'You are a strategist.',
      messages: [{ role: 'user', content: 'Write the line.' }],
    })) {
      streamed.push(chunk);
    }

    expect(streamed).toEqual(['Sharp ', 'strategy']);
    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ role: 'user', content: 'Write the line.' }],
      maxTokens: 321,
      temperature: 0.2,
    }));
  });
});
