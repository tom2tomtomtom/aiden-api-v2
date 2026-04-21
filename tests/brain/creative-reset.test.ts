/**
 * Creative Reset Tests
 *
 * Tests escalation (16 phrases), kill (13 phrases), and sensitive topic detection.
 */

import { describe, it, expect } from 'vitest';
import {
  detectEscalation,
  detectKill,
  detectSensitiveTopic,
  buildCreativeResetContext,
  buildEscalationContext,
  buildSensitiveBraveryContext,
} from '../../src/brain/creative-reset.js';

describe('Creative Reset Detection', () => {
  describe('Escalation Detection (16 phrases)', () => {
    const escalationPhrases = [
      'push it further',
      'push harder',
      'bolder',
      'make me nervous',
      'go further',
      'wilder',
      'edgier',
      'take more risks',
      'less safe',
      'more provocative',
      'be braver',
      'not bold enough',
      'too safe',
      'too tame',
      'shock me',
      'surprise me',
    ];

    for (const phrase of escalationPhrases) {
      it(`detects: "${phrase}"`, () => {
        expect(detectEscalation(`I want you to ${phrase}`)).toBe(true);
      });
    }

    it('does not false-positive on neutral messages', () => {
      expect(detectEscalation('this is a good direction')).toBe(false);
      expect(detectEscalation('lets continue with this')).toBe(false);
      expect(detectEscalation('write me a headline')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(detectEscalation('PUSH IT FURTHER')).toBe(true);
      expect(detectEscalation('Make Me Nervous')).toBe(true);
    });
  });

  describe('Kill Detection (13 phrases)', () => {
    const killPhrases = [
      'kill it',
      'start over',
      'scrap it',
      'from scratch',
      'completely new',
      'throw it away',
      'bin it',
      'start again',
      'nuke it',
      'back to square one',
      'forget that',
      'different direction entirely',
      'total reset',
    ];

    for (const phrase of killPhrases) {
      it(`detects: "${phrase}"`, () => {
        expect(detectKill(`Let's ${phrase}`)).toBe(true);
      });
    }

    it('does not false-positive on iteration language', () => {
      expect(detectKill('refine this')).toBe(false);
      expect(detectKill('iterate on the concept')).toBe(false);
      expect(detectKill('adjust the tone slightly')).toBe(false);
    });
  });

  describe('Sensitive Topic Detection', () => {
    it('detects grief/death topics', () => {
      expect(detectSensitiveTopic('campaign about grief counselling')).toBe(true);
      expect(detectSensitiveTopic('memorial for a death in the family')).toBe(true);
    });

    it('detects mental health topics', () => {
      expect(detectSensitiveTopic('mental health awareness week')).toBe(true);
      expect(detectSensitiveTopic('addressing depression in teens')).toBe(true);
      expect(detectSensitiveTopic('suicide prevention campaign')).toBe(true);
    });

    it('detects hardship topics', () => {
      expect(detectSensitiveTopic('refugee crisis communication')).toBe(true);
      expect(detectSensitiveTopic('homeless shelter fundraiser')).toBe(true);
      expect(detectSensitiveTopic('poverty alleviation programme')).toBe(true);
    });

    it('detects health topics', () => {
      expect(detectSensitiveTopic('cancer research fundraiser')).toBe(true);
      expect(detectSensitiveTopic('disability inclusion campaign')).toBe(true);
    });

    it('does not detect neutral topics', () => {
      expect(detectSensitiveTopic('new shoe launch campaign')).toBe(false);
      expect(detectSensitiveTopic('rebrand for a tech company')).toBe(false);
    });
  });

  describe('Context Builders', () => {
    it('creative reset context inverts premise', () => {
      const ctx = buildCreativeResetContext(true);
      expect(ctx).toContain('opposite premise');
      expect(ctx).toContain('blank page');
    });

    it('no reset context when not a kill', () => {
      expect(buildCreativeResetContext(false)).toBe('');
    });

    it('escalation context grants permission for risk', () => {
      const ctx = buildEscalationContext();
      expect(ctx).toContain('comfort zone');
      expect(ctx).toContain('Bravery');
    });

    it('sensitive bravery context balances honesty and craft', () => {
      const ctx = buildSensitiveBraveryContext();
      expect(ctx).toContain('sensitive topic');
      expect(ctx).toContain('Bravery is still required');
      expect(ctx).toContain('not patronise');
    });
  });
});
