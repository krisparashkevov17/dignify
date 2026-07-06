import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTPUT_SCHEMA, buildUserPrompt, validateAnalysis, toSession,
  validateTranscriptInput, createRateLimiter,
  MAX_TRANSCRIPT_CHARS, MIN_TRANSCRIPT_CHARS, RUBRIC_VERSION,
} from './analyzer.mjs';

function sampleAnalysis(overrides = {}) {
  return {
    conversation: 'Discussion about AI productivity claims',
    scores: { criticalThinking: 58, depth: 67, engagement: 83 },
    offloadingRatio: 35,
    claims: [{ text: 'AI makes everyone smarter', risk: 'medium', tag: 'ai' }],
    topics: ['ai', 'productivity'],
    engagementSignals: ['asks clarifying questions'],
    summary: 'Strong engagement, moderate scrutiny.',
    ...overrides,
  };
}

test('OUTPUT_SCHEMA is structured-outputs safe (no numeric min/max, objects closed)', () => {
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    assert.ok(!('minimum' in node) && !('maximum' in node), 'no numeric constraints allowed');
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, 'objects must be closed');
      assert.ok(Array.isArray(node.required), 'objects must declare required');
      Object.values(node.properties || {}).forEach(walk);
    }
    if (node.items) walk(node.items);
  };
  walk(OUTPUT_SCHEMA);
});

test('buildUserPrompt wraps transcript in tags', () => {
  const p = buildUserPrompt('User: hi');
  assert.ok(p.includes('<transcript>\nUser: hi\n</transcript>'));
});

test('validateAnalysis accepts a valid analysis', () => {
  assert.ok(validateAnalysis(sampleAnalysis()));
});

test('validateAnalysis rejects out-of-range and malformed values', () => {
  assert.throws(() => validateAnalysis(sampleAnalysis({ offloadingRatio: 140 })), /0-100/);
  assert.throws(
    () => validateAnalysis(sampleAnalysis({ scores: { criticalThinking: -3, depth: 1, engagement: 1 } })),
    /criticalThinking/,
  );
  assert.throws(
    () => validateAnalysis(sampleAnalysis({ claims: [{ text: 'x', risk: 'severe', tag: 't' }] })),
    /claim.risk/,
  );
  assert.throws(() => validateAnalysis(sampleAnalysis({ summary: '' })), /summary/);
  assert.throws(() => validateAnalysis(sampleAnalysis({ conversation: '' })), /conversation/);
});

test('toSession produces a schema.json-shaped session with rounded scores', () => {
  const now = new Date('2026-07-06T12:00:00.000Z');
  const s = toSession(sampleAnalysis({ offloadingRatio: 35.6 }), { now });
  assert.equal(s.id, `session-${now.getTime()}`);
  assert.equal(s.timestamp, '2026-07-06T12:00:00.000Z');
  assert.equal(s.source, 'manual');
  assert.equal(s.offloadingRatio, 36);
  assert.equal(s.rubricVersion, RUBRIC_VERSION);
  assert.deepEqual(Object.keys(s.scores), ['criticalThinking', 'depth', 'engagement']);
});

test('validateTranscriptInput enforces presence and size caps', () => {
  assert.throws(() => validateTranscriptInput({}), /required/);
  assert.throws(() => validateTranscriptInput({ transcript: 'hi' }), /too short/);
  assert.throws(
    () => validateTranscriptInput({ transcript: 'x'.repeat(MAX_TRANSCRIPT_CHARS + 1) }),
    /too long/,
  );
  const ok = 'User: '.padEnd(MIN_TRANSCRIPT_CHARS + 10, 'a');
  assert.equal(validateTranscriptInput({ transcript: `  ${ok}  ` }), ok.trim());
});

test('rate limiter allows up to limit, then blocks with retryAfter, then resets', () => {
  const check = createRateLimiter({ limit: 2, windowMs: 1000 });
  const t0 = 1_000_000;
  assert.equal(check('1.2.3.4', t0).allowed, true);
  assert.equal(check('1.2.3.4', t0 + 1).allowed, true);
  const blocked = check('1.2.3.4', t0 + 2);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterS >= 1);
  // Different IP unaffected
  assert.equal(check('5.6.7.8', t0 + 2).allowed, true);
  // Window expiry resets
  assert.equal(check('1.2.3.4', t0 + 1500).allowed, true);
});
