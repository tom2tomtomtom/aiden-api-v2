/**
 * Chat Endpoint Tests
 *
 * Tests request validation and mock brain response.
 */

import { describe, it, expect } from 'vitest';
import { ChatRequestSchema, buildBrainInputFromChatRequest } from '../../src/api/routes/chat.js';

describe('Chat Endpoint', () => {
  describe('Request Validation', () => {
    it('accepts valid minimal request', () => {
      const result = ChatRequestSchema.safeParse({
        message: 'Hello AIDEN',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.message).toBe('Hello AIDEN');
        expect(result.data.stream).toBe(false);
      }
    });

    it('accepts full request with all fields', () => {
      const result = ChatRequestSchema.safeParse({
        message: 'Write me a campaign strategy',
        conversation_id: 'conv-123',
        model: 'claude-sonnet-4-6',
        personality_mode: 'challenger',
        campaign_id: 'camp-456',
        stream: true,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.personality_mode).toBe('challenger');
        expect(result.data.stream).toBe(true);
      }
    });

    it('rejects empty message', () => {
      const result = ChatRequestSchema.safeParse({
        message: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing message', () => {
      const result = ChatRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects invalid personality mode', () => {
      const result = ChatRequestSchema.safeParse({
        message: 'test',
        personality_mode: 'invalid_mode',
      });
      expect(result.success).toBe(false);
    });

    it('accepts all valid personality modes', () => {
      for (const mode of ['collaborator', 'challenger', 'collaborative']) {
        const result = ChatRequestSchema.safeParse({
          message: 'test',
          personality_mode: mode,
        });
        expect(result.success).toBe(true);
      }
    });

    it('defaults stream to false', () => {
      const result = ChatRequestSchema.safeParse({
        message: 'test',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.stream).toBe(false);
      }
    });

    it('rejects dual mode with streaming instead of silently dropping vanilla output', () => {
      const result = ChatRequestSchema.safeParse({
        message: 'Compare both modes',
        stream: true,
        dual_mode: true,
      });

      expect(result.success).toBe(false);
    });

    it('accepts base64 image attachments for vision review', () => {
      const result = ChatRequestSchema.safeParse({
        message: 'Judge this execution directly.',
        images: [
          {
            media_type: 'image/png',
            data: 'data:image/png;base64,aGVsbG8=',
            label: 'first frame',
          },
        ],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.images?.[0].data).toBe('aGVsbG8=');
        expect(result.data.images?.[0].label).toBe('first frame');
      }
    });

    it('rejects unsupported vision media types', () => {
      const result = ChatRequestSchema.safeParse({
        message: 'Judge this execution directly.',
        images: [
          {
            media_type: 'image/svg+xml',
            data: 'aGVsbG8=',
          },
        ],
      });

      expect(result.success).toBe(false);
    });

    it('rejects invalid base64 image payloads', () => {
      const result = ChatRequestSchema.safeParse({
        message: 'Judge this execution directly.',
        images: [
          {
            media_type: 'image/jpeg',
            data: 'not base64',
          },
        ],
      });

      expect(result.success).toBe(false);
    });

    it('passes validated images through to Brain vision attachments', () => {
      const parsed = ChatRequestSchema.parse({
        message: 'Judge this execution directly.',
        conversation_id: 'conv-vision',
        personality_mode: 'challenger',
        images: [
          {
            media_type: 'image/png',
            data: 'data:image/png;base64,aGVsbG8=',
            label: 'opening frame',
          },
        ],
      });

      const brainInput = buildBrainInputFromChatRequest(
        parsed,
        'conv-vision',
        'tenant-123',
        [],
      );

      expect(brainInput.visionAttachments).toEqual([
        {
          mediaType: 'image/png',
          data: 'aGVsbG8=',
          label: 'opening frame',
        },
      ]);
      expect(brainInput.personalityMode).toBe('challenger');
    });
  });

  describe('Mock Brain Response Structure', () => {
    it('validates expected response shape', () => {
      // Simulate what the chat endpoint would return
      const mockResponse = {
        success: true,
        data: {
          content: 'Here is my creative response...',
          conversation_id: 'conv-123',
          phantoms_fired: [
            { shorthand: 'challenger_instinct', score: 5.2, source: 'base' },
            { shorthand: 'bold_direction', score: 3.8, source: 'base' },
          ],
          collisions: [
            { phantomA: 'brevity', phantomB: 'depth', tension: 'brief vs deep' },
          ],
          thinking_mode: { mode: 'generative', label: 'Generative', description: 'Creating new ideas' },
          maturity_stage: 'exploring',
        },
      };

      expect(mockResponse.success).toBe(true);
      expect(mockResponse.data.phantoms_fired.length).toBe(2);
      expect(mockResponse.data.collisions.length).toBe(1);
      expect(mockResponse.data.thinking_mode.mode).toBe('generative');
    });

    it('validates streaming event structure', () => {
      // SSE events the streaming endpoint would emit
      const textEvent = { type: 'text', data: 'Here is' };
      const phantomEvent = {
        type: 'phantom',
        data: [{ shorthand: 'test', score: 5.0, source: 'base' }],
      };
      const doneEvent = {
        type: 'done',
        data: { conversation_id: 'conv-1', maturity_stage: 'exploring', personality_mode: 'collaborator' },
      };

      expect(textEvent.type).toBe('text');
      expect(phantomEvent.data[0].shorthand).toBe('test');
      expect(doneEvent.data.conversation_id).toBe('conv-1');
    });
  });
});
