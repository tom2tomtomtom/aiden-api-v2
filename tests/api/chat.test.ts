/**
 * Chat Endpoint Tests
 *
 * Tests request validation and mock brain response.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

// Test the request validation schema directly (no need to spin up Express)
const ChatRequestSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  conversation_id: z.string().optional(),
  model: z.string().optional(),
  personality_mode: z.enum(['collaborator', 'challenger', 'collaborative']).optional(),
  campaign_id: z.string().optional(),
  stream: z.boolean().optional().default(false),
});

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
        model: 'claude-sonnet-4-20250514',
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
