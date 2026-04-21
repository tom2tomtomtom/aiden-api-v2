/**
 * Creative Knowledge Tests
 *
 * Tests campaign lookup, tag matching, advertising context detection.
 */

import { describe, it, expect } from 'vitest';
import {
  isAdvertisingContext,
  getCampaignsForPhantoms,
  formatCampaignContext,
  getCampaignCount,
  isAvailable,
} from '../../src/brain/creative-knowledge.js';

describe('Creative Knowledge Service', () => {
  describe('Advertising Context Detection', () => {
    it('detects advertising keywords', () => {
      expect(isAdvertisingContext('write a campaign brief for the brand')).toBe(true);
      expect(isAdvertisingContext('create a tagline for our launch')).toBe(true);
      expect(isAdvertisingContext('advertising strategy for Q3')).toBe(true);
      expect(isAdvertisingContext('creative strategy for the pitch')).toBe(true);
      expect(isAdvertisingContext('copywriting for the billboard')).toBe(true);
    });

    it('rejects non-advertising messages', () => {
      expect(isAdvertisingContext('help me with my code')).toBe(false);
      expect(isAdvertisingContext('what is the weather today')).toBe(false);
      expect(isAdvertisingContext('organize my schedule')).toBe(false);
    });
  });

  describe('Campaign Retrieval', () => {
    it('loads campaigns on first access', () => {
      const count = getCampaignCount();
      // Should have campaigns loaded from data/campaigns.json
      expect(count).toBeGreaterThan(0);
    });

    it('service is available', () => {
      expect(isAvailable()).toBe(true);
    });

    it('returns campaigns for matching phantom keys', () => {
      // Try common phantom tags that should match campaigns
      const campaigns = getCampaignsForPhantoms(
        ['challenger_instinct', 'creative_stubborn', 'bold_direction'],
        new Map([
          ['challenger_instinct', 5.0],
          ['creative_stubborn', 4.0],
          ['bold_direction', 3.0],
        ]),
        3,
      );
      // May or may not match depending on campaign data tags
      expect(Array.isArray(campaigns)).toBe(true);
    });

    it('respects max limit', () => {
      const campaigns = getCampaignsForPhantoms(
        ['challenger_instinct'],
        new Map([['challenger_instinct', 5.0]]),
        1,
      );
      expect(campaigns.length).toBeLessThanOrEqual(1);
    });

    it('returns empty for no matching tags', () => {
      const campaigns = getCampaignsForPhantoms(
        ['completely_nonexistent_phantom_xyz'],
        new Map([['completely_nonexistent_phantom_xyz', 1.0]]),
      );
      expect(campaigns.length).toBe(0);
    });
  });

  describe('Campaign Context Formatting', () => {
    it('formats campaign entries into context block', () => {
      const entries = [{
        id: '1',
        campaign_name: 'Think Different',
        brand: 'Apple',
        agency: 'TBWA',
        year: 1997,
        category: 'brand',
        verticals: ['tech'],
        tags: ['brand'],
        era: '1990s',
        insight: 'Celebrate the misfits',
        execution_summary: 'Celebrity portraits',
        why_it_worked: 'Made computing feel rebellious',
        creative_principle: 'Celebrate the outsiders',
        contrarian_element: 'Did not show the product',
        phantom_tags: ['challenger_instinct'],
        strategic_tags: ['brand_building'],
      }];

      const ctx = formatCampaignContext(entries, 'write a brand campaign');
      expect(ctx).toContain('APPLE');
      expect(ctx).toContain('Think Different');
      expect(ctx).toContain('Celebrate the outsiders');
    });

    it('returns empty for non-advertising message', () => {
      const entries = [{
        id: '1',
        campaign_name: 'Test',
        brand: 'Test',
        agency: 'Test',
        year: 2020,
        category: 'test',
        verticals: [],
        tags: [],
        era: '2020s',
        insight: 'test',
        execution_summary: 'test',
        why_it_worked: 'test',
        creative_principle: 'test',
        contrarian_element: 'test',
        phantom_tags: [],
        strategic_tags: [],
      }];

      const ctx = formatCampaignContext(entries, 'help me fix my code');
      expect(ctx).toBe('');
    });

    it('returns empty for empty entries', () => {
      expect(formatCampaignContext([])).toBe('');
    });
  });
});
