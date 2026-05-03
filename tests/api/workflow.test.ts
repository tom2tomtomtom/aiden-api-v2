import { describe, expect, it } from 'vitest';

import { serializeWorkflowSession } from '../../src/api/routes/workflow.js';
import { WorkflowStep, type WorkflowSession } from '../../src/api/workflow/session.js';

function makeSession(overrides: Partial<WorkflowSession> = {}): WorkflowSession {
  return {
    id: 'wf-test',
    tenant_id: 'tenant-test',
    step: WorkflowStep.COPY_SUITE_READY,
    campaign_id: 'campaign-test',
    brief_data: { raw_brief: 'Launch the bag.' },
    strategy: 'Position around practical confidence.',
    territories: '1. Quiet authority\n2. Useful rebellion',
    selected_territory: 'Territory 1',
    big_ideas: '1. Built for the day that actually happens.',
    selected_big_idea: 'Big Idea 1',
    copy_suite: 'Headline: Carries the whole day.\nCTA: Shop now.',
    selected_formats: ['social'],
    active_job_id: null,
    messages: [],
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

describe('Workflow route serialization', () => {
  it('exposes locked workflow outputs for downstream render handoff', () => {
    const data = serializeWorkflowSession(makeSession());

    expect(data.has_copy_suite).toBe(true);
    expect(data.strategy).toBe('Position around practical confidence.');
    expect(data.selected_territory).toBe('Territory 1');
    expect(data.selected_big_idea).toBe('Big Idea 1');
    expect(data.copy_suite).toContain('Headline: Carries the whole day.');
    expect(data.brief_data).toEqual({ raw_brief: 'Launch the bag.' });
  });
});
