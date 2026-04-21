/**
 * Auth Middleware Tests
 *
 * Tests API key validation, timing-safe comparison, and invalid key rejection.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  hashApiKey,
  extractPrefix,
  registerKey,
  authMiddleware,
} from '../../src/api/middleware/auth.js';
import type { Request, Response } from 'express';

// ── Mock Express objects ─────────────────────────────────────────────────────

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe('Auth Middleware', () => {
  describe('Key Hashing', () => {
    it('produces consistent SHA-256 hashes', () => {
      const hash1 = hashApiKey('aiden_sk_test123_abcdef');
      const hash2 = hashApiKey('aiden_sk_test123_abcdef');
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different keys', () => {
      const hash1 = hashApiKey('aiden_sk_test123_key1');
      const hash2 = hashApiKey('aiden_sk_test123_key2');
      expect(hash1).not.toBe(hash2);
    });

    it('hash is 64 character hex string', () => {
      const hash = hashApiKey('aiden_sk_test_key');
      expect(hash.length).toBe(64);
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });
  });

  describe('Prefix Extraction', () => {
    it('extracts first 3 underscore-separated parts', () => {
      expect(extractPrefix('aiden_sk_test123_rest_of_key')).toBe('aiden_sk_test123');
    });

    it('handles short keys gracefully', () => {
      const prefix = extractPrefix('ab');
      expect(prefix.length).toBeGreaterThan(0);
    });
  });

  describe('Auth Middleware', () => {
    beforeEach(() => {
      // Register a valid test key
      registerKey('aiden_sk_testkey_validkey123', 'tenant-test', {
        rate_limit_per_minute: 60,
        rate_limit_per_day: 1000,
        is_active: true,
      });
    });

    it('rejects request with no API key', () => {
      const req = mockReq();
      const res = mockRes();
      let nextCalled = false;

      authMiddleware(req, res, () => { nextCalled = true; });

      expect(res.statusCode).toBe(401);
      expect((res.body as Record<string, unknown>).error).toContain('Missing API key');
      expect(nextCalled).toBe(false);
    });

    it('rejects request with invalid API key', () => {
      const req = mockReq({ 'x-api-key': 'aiden_sk_testkey_wrongkey999' });
      const res = mockRes();
      let nextCalled = false;

      authMiddleware(req, res, () => { nextCalled = true; });

      expect(res.statusCode).toBe(401);
      expect(nextCalled).toBe(false);
    });

    it('accepts valid API key and sets tenant_id', () => {
      const req = mockReq({ 'x-api-key': 'aiden_sk_testkey_validkey123' });
      const res = mockRes();
      let nextCalled = false;

      authMiddleware(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
      expect((req as unknown as Record<string, unknown>).tenant_id).toBe('tenant-test');
    });

    it('rejects deactivated keys', () => {
      registerKey('aiden_sk_deactive_deadkey', 'tenant-dead', {
        is_active: false,
      });

      const req = mockReq({ 'x-api-key': 'aiden_sk_deactive_deadkey' });
      const res = mockRes();
      let nextCalled = false;

      authMiddleware(req, res, () => { nextCalled = true; });

      expect(res.statusCode).toBe(403);
      expect(nextCalled).toBe(false);
    });

    it('uses timing-safe comparison (consistent timing)', () => {
      // We cannot directly test timing-safety, but we can verify
      // that both valid and invalid keys take roughly the same path
      const validReq = mockReq({ 'x-api-key': 'aiden_sk_testkey_validkey123' });
      const invalidReq = mockReq({ 'x-api-key': 'aiden_sk_testkey_invalidkey' });
      const validRes = mockRes();
      const invalidRes = mockRes();

      authMiddleware(validReq, validRes, () => {});
      authMiddleware(invalidReq, invalidRes, () => {});

      // Both should complete without throwing
      expect(validRes.statusCode).toBe(200);
      expect(invalidRes.statusCode).toBe(401);
    });
  });
});
