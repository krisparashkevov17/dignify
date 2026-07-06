// Integration tests for the /api/analyze handler. The Anthropic SDK honors
// ANTHROPIC_BASE_URL, so we point it at a local mock Messages API — the full
// handler pipeline (validation, rate limit, SDK call, parsing, session
// assembly) runs with zero network and zero cost.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const GOOD_ANALYSIS = {
  conversation: 'AI productivity discussion',
  scores: { criticalThinking: 55, depth: 60, engagement: 72 },
  offloadingRatio: 40,
  claims: [{ text: 'AI boosts productivity for everyone', risk: 'medium', tag: 'ai' }],
  topics: ['ai', 'productivity'],
  engagementSignals: ['asks follow-up questions'],
  summary: 'Engaged but accepts productivity claims uncritically.',
};

function messageResponse(overrides = {}) {
  return {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-4-8',
    content: [{ type: 'text', text: JSON.stringify(GOOD_ANALYSIS) }],
    stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 100 },
    ...overrides,
  };
}

let server;
let handler;

before(async () => {
  // Mock Messages API: behavior keyed off markers in the transcript.
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      const userText = body.messages[0].content;
      const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (userText.includes('MARKER_REFUSE')) {
        return send(200, messageResponse({ content: [], stop_reason: 'refusal' }));
      }
      if (userText.includes('MARKER_UPSTREAM_400')) {
        return send(400, { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } });
      }
      if (userText.includes('MARKER_BAD_JSON')) {
        return send(200, messageResponse({ content: [{ type: 'text', text: '{"scores":' }] }));
      }
      return send(200, messageResponse());
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ANALYZER_RATE_LIMIT = '3';
  ({ default: handler } = await import('./analyze.mjs'));
});

after(() => server.close());

function makeReq({ method = 'POST', body, ip = '10.0.0.1' } = {}) {
  return { method, body, headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip } };
}

function makeRes() {
  const res = {
    statusCode: null, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(obj) { this.body = obj; return this; },
  };
  return res;
}

const TRANSCRIPT = 'User: I read that AI tools make everyone more productive, is that true?\nAssistant: The research is nuanced...\nUser: Interesting, what evidence supports that?';

test('happy path returns a schema-shaped session', async () => {
  const res = makeRes();
  await handler(makeReq({ body: { transcript: TRANSCRIPT }, ip: '10.0.0.2' }), res);
  assert.equal(res.statusCode, 200);
  const s = res.body.session;
  assert.match(s.id, /^session-\d+$/);
  assert.equal(s.source, 'manual');
  assert.deepEqual(s.scores, GOOD_ANALYSIS.scores);
  assert.equal(s.offloadingRatio, 40);
  assert.equal(s.rubricVersion, '1.0');
  assert.equal(res.body.model, 'claude-opus-4-8');
});

test('non-POST is 405', async () => {
  const res = makeRes();
  await handler(makeReq({ method: 'GET', ip: '10.0.0.3' }), res);
  assert.equal(res.statusCode, 405);
});

test('missing/short transcript is 400 before any API spend', async () => {
  for (const body of [undefined, {}, { transcript: 'hi' }]) {
    const res = makeRes();
    await handler(makeReq({ body, ip: '10.0.0.4' }), res);
    assert.equal(res.statusCode, 400);
  }
});

test('model refusal maps to 422', async () => {
  const res = makeRes();
  await handler(makeReq({ body: { transcript: `${TRANSCRIPT} MARKER_REFUSE` }, ip: '10.0.0.5' }), res);
  assert.equal(res.statusCode, 422);
});

test('upstream API error maps to 502', async () => {
  const res = makeRes();
  await handler(makeReq({ body: { transcript: `${TRANSCRIPT} MARKER_UPSTREAM_400` }, ip: '10.0.0.6' }), res);
  assert.equal(res.statusCode, 502);
});

test('unparseable model output maps to 500', async () => {
  const res = makeRes();
  await handler(makeReq({ body: { transcript: `${TRANSCRIPT} MARKER_BAD_JSON` }, ip: '10.0.0.7' }), res);
  assert.equal(res.statusCode, 500);
});

test('per-IP rate limit returns 429 with Retry-After', async () => {
  const ip = '10.0.0.99';
  for (let i = 0; i < 3; i++) {
    const res = makeRes();
    await handler(makeReq({ body: { transcript: TRANSCRIPT }, ip }), res);
    assert.equal(res.statusCode, 200, `request ${i + 1} should pass`);
  }
  const res = makeRes();
  await handler(makeReq({ body: { transcript: TRANSCRIPT }, ip }), res);
  assert.equal(res.statusCode, 429);
  assert.ok(Number(res.headers['Retry-After']) > 0);
  // Other IPs unaffected
  const res2 = makeRes();
  await handler(makeReq({ body: { transcript: TRANSCRIPT }, ip: '10.0.0.100' }), res2);
  assert.equal(res2.statusCode, 200);
});

test('missing ANTHROPIC_API_KEY returns 503 with demo hint', async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const res = makeRes();
    await handler(makeReq({ body: { transcript: TRANSCRIPT }, ip: '10.0.0.8' }), res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /demo/i);
  } finally {
    process.env.ANTHROPIC_API_KEY = saved;
  }
});
