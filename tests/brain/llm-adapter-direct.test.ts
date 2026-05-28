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

describe('LLMAdapter direct Anthropic handling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.AIDEN_LLM_PROVIDER = 'anthropic';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('preserves direct Anthropic errors without routing through another provider', async () => {
    const anthropicError = new Error('Could not process image');
    anthropicCreateMock.mockRejectedValue(anthropicError);

    const { LLMAdapter } = await import('../../src/brain/llm-adapter.js');
    const adapter = new LLMAdapter({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-5-20250929',
    });

    await expect(adapter.generateText({ prompt: 'Judge this image.' })).rejects.toThrow(
      'Could not process image',
    );
    expect(anthropicCreateMock).toHaveBeenCalledTimes(1);
  });
});
