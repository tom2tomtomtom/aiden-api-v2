import { describe, expect, it } from 'vitest';
import { buildVisionUserContent } from '../../src/brain/nuclear-brain.js';

describe('vision attachments', () => {
  it('keeps text-only messages as plain strings', () => {
    expect(buildVisionUserContent('Judge this execution.')).toBe('Judge this execution.');
  });

  it('turns image attachments into Anthropic vision content blocks', () => {
    const content = buildVisionUserContent('Judge this execution.', [
      {
        mediaType: 'image/png',
        data: 'aGVsbG8=',
        label: 'opening frame',
      },
    ]);

    expect(content).toEqual([
      {
        type: 'text',
        text: 'Judge this execution.\n\nAttached visual evidence:\n1. opening frame',
      },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'aGVsbG8=',
        },
      },
    ]);
  });
});
