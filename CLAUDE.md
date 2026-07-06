# Cognify

Scores the cognitive quality of AI conversations — critical thinking, depth, engagement,
and a signature **Cognitive Offloading Ratio** — against a rubric grounded in cognitive
science (ICAP, Paul–Elder, SOLO, epistemic vigilance). Started as a hackathon project
(CognitionOS), relaunched as a public tool + Claude Code skill.

This is a portfolio piece for AI-eval platform applications — it needs to look credible
to someone reviewing it in under two minutes. The sample report must work with zero
setup; live scoring must never expose an API key or run unmetered.

## Architecture (one contract, three surfaces)

- `skill/reference/schema.json` — the shared session contract. Everything speaks it.
- `skill/` — Claude Code skill: rubric (`SKILL.md`), local store (`scripts/cognify-store.mjs`,
  dependency-free, writes `~/.cognify/profile.json`), Phase-2 auto-scoring hook (`hooks/`).
- `app/` — React + Vite + Tailwind web app: public analyzer (paste transcript → report)
  and local dashboard (trends, fingerprint, blind spots). Monochrome instrument design:
  b/w only, inversion is the accent, five-band rubric gauges are the signature element.
- `api/` — Vercel serverless scoring endpoint. `_lib/analyzer.mjs` is dependency-free
  (prompt, output schema, validation, rate limiter); only `analyze.mjs` touches the
  Anthropic SDK. Key lives in `ANTHROPIC_API_KEY` env; structured outputs enforce the
  response shape; ranges are validated server-side.

The rubric text exists in two places by design: `skill/SKILL.md` (source of truth) and
`api/_lib/analyzer.mjs` (self-contained copy for the serverless bundle). If you change
one, change the other and bump `rubricVersion`.

## Commands

```bash
npm test        # all suites: store + analyzer + API handler (node:test, zero frameworks)
npm run build   # Vite build of app/
vercel dev      # local API on :3000 (app dev server proxies /api to it)
```

API handler tests run against a mock Messages API via `ANTHROPIC_BASE_URL` — no key, no
cost. Don't add a test that makes real API calls.

## Constraints

- The store and analyzer core stay dependency-free (node:test only). The SDK is allowed
  only in `api/analyze.mjs`.
- Sessions store labels + scores, never raw transcripts (privacy is a feature).
- The skill is installed by symlinking `skill/` → `~/.claude/skills/cognify`; anything the
  skill needs at runtime must live under `skill/` (see the symlink bug fixed in
  `cognify-store.test.mjs` — CLI entrypoint checks must resolve realpaths).
- Rate limiting is per-warm-instance and documented as such — don't claim global limits.
