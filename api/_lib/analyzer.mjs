// Cognify public analyzer — prompt, output schema, validation, session assembly.
//
// Dependency-free on purpose: everything here is pure functions/data so it can
// be unit-tested with node:test and reused by any backend. Only api/analyze.mjs
// touches the Anthropic SDK.
//
// The rubric text mirrors skill/SKILL.md and skill/reference/scientific-basis.md
// (the source of truth). If the rubric changes there, update ANALYZER_SYSTEM_PROMPT
// and bump RUBRIC_VERSION.

export const RUBRIC_VERSION = '1.0';

// Keep public-endpoint costs bounded: ~24k chars ≈ 6-8k tokens of transcript.
export const MAX_TRANSCRIPT_CHARS = 24_000;
export const MIN_TRANSCRIPT_CHARS = 80;

export const ANALYZER_SYSTEM_PROMPT = `You are Cognify, a cognitive analysis engine. You score the USER's contributions in an AI conversation transcript against a rubric grounded in cognitive science (ICAP, Paul-Elder, SOLO taxonomy, epistemic vigilance, cognitive-offloading theory).

Score ONLY the human user's messages, not the assistant's. Be accurate, not flattering — never inflate scores to please. Score observable behavior confidently; hedge trait-level inferences.

Dimensions (0-100 each, using this five-band ladder):
- 0-20 Passive/Surface: restating, agreeing without content; no reasoning visible.
- 21-40 Active/Unistructural: manipulates given content but adds nothing new.
- 41-60 Constructive/Multistructural: generates explanations, examples, inferences; several relevant but loosely connected points.
- 61-80 Interactive-emerging/Relational: integrates into coherent argument, weighs evidence and counterarguments, makes assumptions explicit.
- 81-100 Interactive/Extended-Abstract: co-constructs and extends reasoning, synthesizes novel connections, calibrates confidence, self-corrects.

Score definitions:
- criticalThinking: assumptions made explicit, evidence requested, counterarguments weighed, confidence calibrated.
- depth: isolated facts (low) vs integrated, generalized reasoning (high).
- engagement: restating (low) vs building on / extending ideas (high).
- offloadingRatio (0-100): share of cognitive work delegated wholesale to the AI vs retained and verified by the user. Higher = more offloading. This is the signature metric.

Also extract:
- claims: significant claims the user made or accepted, each with risk (high = accepted uncritically / no source / miscalibrated confidence; medium; low) and a short topic tag.
- topics: main subjects discussed.
- engagementSignals: observable behaviors (clarifying questions, self-correction, source requests, uncritical acceptance...).
- summary: 2-3 sentence narrative of the cognitive patterns.
- conversation: a SHORT descriptive label for the conversation (max ~10 words). Never reproduce transcript content in it.

If the input is not a conversation transcript (random text, code dump, empty chatter), still score it: near-zero scores, empty claims, and a summary noting it is not a scoreable conversation.`;

// JSON Schema for the API's structured-output constraint. Structured outputs
// don't support numeric minimum/maximum, so ranges are enforced by
// validateAnalysis() below instead.
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    conversation: { type: 'string', description: 'Short label, never transcript content' },
    scores: {
      type: 'object',
      properties: {
        criticalThinking: { type: 'number' },
        depth: { type: 'number' },
        engagement: { type: 'number' },
      },
      required: ['criticalThinking', 'depth', 'engagement'],
      additionalProperties: false,
    },
    offloadingRatio: { type: 'number' },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          risk: { type: 'string', enum: ['high', 'medium', 'low'] },
          tag: { type: 'string' },
        },
        required: ['text', 'risk', 'tag'],
        additionalProperties: false,
      },
    },
    topics: { type: 'array', items: { type: 'string' } },
    engagementSignals: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: [
    'conversation', 'scores', 'offloadingRatio', 'claims',
    'topics', 'engagementSignals', 'summary',
  ],
  additionalProperties: false,
};

export function buildUserPrompt(transcript) {
  return `Score the user's contributions in the following conversation transcript.\n\n<transcript>\n${transcript}\n</transcript>`;
}

function inRange(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
}

// Validate the model's structured output beyond what the schema can express
// (0-100 ranges, non-empty label/summary). Throws with a specific message.
export function validateAnalysis(a) {
  if (!a || typeof a !== 'object') throw new Error('analysis must be an object');
  if (!a.scores || typeof a.scores !== 'object') throw new Error('analysis.scores required');
  for (const k of ['criticalThinking', 'depth', 'engagement']) {
    if (!inRange(a.scores[k])) throw new Error(`scores.${k} must be 0-100`);
  }
  if (!inRange(a.offloadingRatio)) throw new Error('offloadingRatio must be 0-100');
  for (const k of ['claims', 'topics', 'engagementSignals']) {
    if (!Array.isArray(a[k])) throw new Error(`analysis.${k} must be an array`);
  }
  for (const c of a.claims) {
    if (!c || typeof c.text !== 'string' || !c.text) throw new Error('claim.text required');
    if (!['high', 'medium', 'low'].includes(c.risk)) throw new Error('claim.risk must be high|medium|low');
    if (typeof c.tag !== 'string') throw new Error('claim.tag must be a string');
  }
  if (typeof a.summary !== 'string' || !a.summary) throw new Error('analysis.summary required');
  if (typeof a.conversation !== 'string' || !a.conversation) throw new Error('analysis.conversation required');
  return true;
}

// Assemble a full session object matching skill/reference/schema.json, so the
// result can be downloaded and imported straight into the Cognify dashboard.
export function toSession(analysis, { now = new Date() } = {}) {
  return {
    id: `session-${now.getTime()}`,
    timestamp: now.toISOString(),
    source: 'manual',
    conversation: analysis.conversation,
    scores: {
      criticalThinking: Math.round(analysis.scores.criticalThinking),
      depth: Math.round(analysis.scores.depth),
      engagement: Math.round(analysis.scores.engagement),
    },
    offloadingRatio: Math.round(analysis.offloadingRatio),
    claims: analysis.claims,
    topics: analysis.topics,
    engagementSignals: analysis.engagementSignals,
    summary: analysis.summary,
    rubricVersion: RUBRIC_VERSION,
  };
}

// Validate raw request input before spending an API call on it.
// Returns a trimmed transcript or throws with a client-safe message.
export function validateTranscriptInput(body) {
  const transcript = body && typeof body.transcript === 'string' ? body.transcript.trim() : '';
  if (!transcript) throw new Error('transcript is required');
  if (transcript.length < MIN_TRANSCRIPT_CHARS) {
    throw new Error(`transcript too short to score (min ${MIN_TRANSCRIPT_CHARS} characters)`);
  }
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    throw new Error(`transcript too long (max ${MAX_TRANSCRIPT_CHARS.toLocaleString('en-US')} characters) — trim it and retry`);
  }
  return transcript;
}

// Best-effort in-memory per-IP rate limiter (fixed window). Serverless
// instances don't share memory, so this bounds abuse per warm instance rather
// than globally — acceptable for a portfolio deployment and documented as such.
export function createRateLimiter({ limit = 10, windowMs = 60 * 60 * 1000 } = {}) {
  const hits = new Map(); // ip -> number[] of timestamps
  return function check(ip, nowMs = Date.now()) {
    const cutoff = nowMs - windowMs;
    const list = (hits.get(ip) || []).filter((t) => t > cutoff);
    if (list.length >= limit) {
      hits.set(ip, list);
      const retryAfterS = Math.max(1, Math.ceil((list[0] + windowMs - nowMs) / 1000));
      return { allowed: false, retryAfterS };
    }
    list.push(nowMs);
    hits.set(ip, list);
    // Opportunistic cleanup so the map can't grow unbounded.
    if (hits.size > 5000) {
      for (const [k, v] of hits) {
        if (v.every((t) => t <= cutoff)) hits.delete(k);
      }
    }
    return { allowed: true, remaining: limit - list.length };
  };
}
