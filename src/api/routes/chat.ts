/**
 * Chat Endpoint - Streaming + Non-streaming
 *
 * POST /api/v1/chat
 *
 * The primary brain interaction endpoint. Accepts a message,
 * runs it through the full Nuclear Brain pipeline, and returns
 * the response with phantom activation metadata.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { processMessage, processMessageStream } from '../../brain/nuclear-brain.js';
import { createBrainServices } from '../service-factory.js';
import type { PersonalityMode, ConversationExchange } from '../../types.js';

const router = Router();

// ── Request validation ────────────────────────────────────────────────────────

const ChatRequestSchema = z.object({
  message: z.string().min(1, 'Message is required'),
  conversation_id: z.string().optional(),
  model: z.string().optional(),
  personality_mode: z.enum(['collaborator', 'challenger', 'collaborative']).optional(),
  campaign_id: z.string().optional(),
  stream: z.boolean().optional().default(false),
});

type ChatRequest = z.infer<typeof ChatRequestSchema>;

// ── Route handler ─────────────────────────────────────────────────────────────

router.post('/chat', async (req: Request, res: Response) => {
  // Validate request body
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const body: ChatRequest = parsed.data;
  const tenantId = (req as unknown as Record<string, unknown>).tenant_id as string || 'default';
  const conversationId = body.conversation_id || `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Build brain input
  const brainInput = {
    message: body.message,
    conversationId,
    agencyId: tenantId,
    personalityMode: (body.personality_mode || 'collaborator') as PersonalityMode,
    conversationHistory: [] as ConversationExchange[], // TODO: load from DB
  };

  const services = createBrainServices();

  try {
    if (body.stream) {
      // ── SSE Streaming Response ─────────────────────────────────────────
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const generator = processMessageStream(brainInput, services);
      let metadata = null;

      try {
        while (true) {
          const { value, done } = await generator.next();
          if (done) {
            // The return value is the metadata
            metadata = value;
            break;
          }
          // Send text chunk
          res.write(`data: ${JSON.stringify({ type: 'text', data: value })}\n\n`);
        }

        // Send metadata events
        if (metadata) {
          if (metadata.activatedPhantoms?.length > 0) {
            res.write(`data: ${JSON.stringify({
              type: 'phantom',
              data: metadata.activatedPhantoms.map(p => ({
                shorthand: p.phantom.shorthand,
                score: p.score,
                source: p.source,
              })),
            })}\n\n`);
          }

          if (metadata.collisions?.length > 0) {
            res.write(`data: ${JSON.stringify({
              type: 'collision',
              data: metadata.collisions.map(c => ({
                phantomA: c.phantomA,
                phantomB: c.phantomB,
                tension: c.tensionDescription,
              })),
            })}\n\n`);
          }

          res.write(`data: ${JSON.stringify({
            type: 'thinking_mode',
            data: metadata.thinkingMode,
          })}\n\n`);

          res.write(`data: ${JSON.stringify({
            type: 'done',
            data: {
              conversation_id: conversationId,
              maturity_stage: metadata.maturity,
              personality_mode: metadata.personalityMode,
            },
          })}\n\n`);
        }
      } catch (streamError) {
        res.write(`data: ${JSON.stringify({ type: 'error', data: { message: 'Stream interrupted' } })}\n\n`);
      }

      res.end();
    } else {
      // ── JSON Response ──────────────────────────────────────────────────
      const response = await processMessage(brainInput, services);

      res.json({
        success: true,
        data: {
          content: response.text,
          conversation_id: conversationId,
          phantoms_fired: response.metadata.activatedPhantoms.map(p => ({
            shorthand: p.phantom.shorthand,
            score: p.score,
            source: p.source,
          })),
          collisions: response.metadata.collisions.map(c => ({
            phantomA: c.phantomA,
            phantomB: c.phantomB,
            tension: c.tensionDescription,
          })),
          thinking_mode: response.metadata.thinkingMode,
          maturity_stage: response.metadata.maturity,
        },
      });
    }
  } catch (error) {
    console.error('[Chat] Error processing message:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Brain processing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
});

export default router;
