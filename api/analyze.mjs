// POST /api/analyze — score a pasted transcript with the Cognify rubric.
//
// Vercel Node serverless function. The Anthropic API key lives in the
// ANTHROPIC_API_KEY deployment secret — it never reaches the browser.
// Abuse controls: per-IP rate limit (best-effort per warm instance),
// transcript size caps, bounded max_tokens.

import Anthropic from '@anthropic-ai/sdk';
import {
  ANALYZER_SYSTEM_PROMPT, OUTPUT_SCHEMA, buildUserPrompt,
  validateAnalysis, toSession, validateTranscriptInput, createRateLimiter,
} from './_lib/analyzer.mjs';

// Opus 4.8 default (most capable); override with ANALYZER_MODEL — e.g.
// claude-haiku-4-5 for a cheaper public deployment.
const MODEL = process.env.ANALYZER_MODEL || 'claude-opus-4-8';
const RATE_LIMIT = Number(process.env.ANALYZER_RATE_LIMIT || 10); // per IP per hour
const MAX_TOKENS = 8192; // covers adaptive thinking + the JSON payload

const checkRate = createRateLimiter({ limit: RATE_LIMIT, windowMs: 60 * 60 * 1000 });

let client;
function getClient() {
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return client;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' && fwd.split(',')[0].trim()) || req.socket?.remoteAddress || 'unknown';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: 'Analysis backend is not configured on this deployment. Try the built-in demo, or self-host with an ANTHROPIC_API_KEY.',
    });
  }

  const rate = checkRate(clientIp(req));
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterS));
    return res.status(429).json({
      error: `Rate limit reached — try again in ~${Math.ceil(rate.retryAfterS / 60)} min.`,
    });
  }

  let transcript;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    transcript = validateTranscriptInput(body);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      system: [
        {
          type: 'text',
          text: ANALYZER_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      messages: [{ role: 'user', content: buildUserPrompt(transcript) }],
    });

    if (response.stop_reason === 'refusal') {
      return res.status(422).json({ error: 'The analyzer declined to process this transcript.' });
    }
    if (response.stop_reason === 'max_tokens') {
      return res.status(422).json({ error: 'Transcript too complex to score within limits — try a shorter excerpt.' });
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) throw new Error('no text block in model response');
    const analysis = JSON.parse(textBlock.text);
    validateAnalysis(analysis);

    return res.status(200).json({ session: toSession(analysis), model: response.model });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'Analyzer is busy — try again in a minute.' });
    }
    if (e instanceof Anthropic.AuthenticationError) {
      return res.status(503).json({ error: 'Analysis backend is misconfigured (invalid API key).' });
    }
    if (e instanceof Anthropic.APIConnectionError) {
      return res.status(502).json({ error: 'Could not reach the analysis backend — try again shortly.' });
    }
    if (e instanceof Anthropic.APIError) {
      console.error('anthropic api error', e.status, e.message);
      return res.status(502).json({ error: 'Analysis failed upstream — try again shortly.' });
    }
    console.error('analyze error', e);
    return res.status(500).json({ error: 'Analysis failed — try again shortly.' });
  }
}
