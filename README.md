<div align="center">

# 🧠 Cognify

### A cognitive-fitness tracker for your AI conversations

**Cognify scores _how you think_ with AI** — critical thinking, depth, engagement, and a
**Cognitive Offloading Ratio** — straight from the conversation Claude already has in context.
No copy. No paste.

[![Claude Skill](https://img.shields.io/badge/Claude-Skill-4f46e5?style=flat-square&logo=anthropic&logoColor=white)](#install-the-skill-claude-code)
[![Grounded in cognitive science](https://img.shields.io/badge/grounded%20in-cognitive%20science-f59e0b?style=flat-square)](skill/reference/scientific-basis.md)
[![Node ≥18](https://img.shields.io/badge/node-%E2%89%A518-22c55e?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![React 18](https://img.shields.io/badge/dashboard-React%2018-0ea5e9?style=flat-square&logo=react&logoColor=white)](app/)
[![License: MIT](https://img.shields.io/badge/license-MIT-64748b?style=flat-square)](LICENSE)

</div>

---

## The problem

Every study on AI and thinking points the same way: the more we lean on AI, the less we engage our
own critical faculties — **cognitive offloading** ([Sparrow et al., 2011](skill/reference/scientific-basis.md);
[Gerlich, 2025](skill/reference/scientific-basis.md)). The catch is that those studies all rely on
*self-report*. Nobody measures what actually happens in real conversations.

**Cognify does.** It reads the conversation you just had with Claude and tells you how hard *you* were
actually thinking — then tracks it over time, like a fitness tracker for your mind.

## What you get

Ask Claude **"score my thinking"** at the end of any conversation and you get an instant read:

```text
  Cognify — cognitive scorecard
  ────────────────────────────────────────────
  Critical thinking   72 / 100   ▓▓▓▓▓▓▓░░░
  Depth               67 / 100   ▓▓▓▓▓▓░░░░
  Engagement          83 / 100   ▓▓▓▓▓▓▓▓░░
  Offloading ratio    35 / 100   ▓▓▓░░░░░░░  (lower is healthier)

  ⚑ Flagged claim (high): "Vitamin D cures depression" — accepted with no source
  ✎ Takeaway: Strong, curious engagement — but scrutiny drops on health claims.
```

Then open the **dashboard** to see the longitudinal picture: trends, your cognitive fingerprint,
recurring blind spots, strengths, and your offloading ratio over time.

## The public analyzer

Cognify is also a **public web tool**: paste any AI conversation transcript and get the same
science-grounded report in your browser — four scores on the five-band rubric ladder, claims
flagged by epistemic risk, and a downloadable session you can import into the dashboard.
No sign-up. Rate-limited. The API key never leaves the server.

**Deploy your own in ~2 minutes (Vercel):**

```bash
npm i -g vercel
vercel                       # from the repo root — build config is in vercel.json
vercel env add ANTHROPIC_API_KEY   # paste your key from platform.claude.com
vercel --prod
```

Configuration (see [`.env.example`](.env.example)):

| Env var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required for live scoring. Without it the site still works in sample mode. |
| `ANALYZER_MODEL` | `claude-opus-4-8` | Set `claude-haiku-4-5` for a ~5× cheaper public deployment. |
| `ANALYZER_RATE_LIMIT` | `10` | Scorings per IP per hour (best-effort, per warm instance). |

Abuse controls are honest, not theatrical: per-IP rate limiting is in-memory per serverless
instance (documented, not pretended-global), transcripts are capped at 24k characters, output
tokens are bounded, and transcripts are scored — never stored.

**Local dev:** `vercel dev` at the repo root serves the API on `:3000`; `cd app && npm run dev`
serves the UI with a proxy to it.

## Features

| | |
|---|---|
| 🗣️ **Zero friction** | Scores the live conversation in context — nothing to copy or paste. |
| 🔬 **Grounded in science** | Every score maps to a cited construct: ICAP, Paul–Elder, SOLO, epistemic vigilance. |
| 📊 **Offloading Ratio** | A behavioral metric no current study measures — effortful engagement vs. wholesale offloading. |
| 📈 **Longitudinal profile** | Trends, fingerprint, blind spots, and strengths across every session. |
| 🛡️ **Honest by design** | An anti-sycophancy guardrail: scores observable behavior, never flatters. |
| 🔒 **Private by default** | Stores labels + scores locally in `~/.cognify/profile.json` — never your raw transcripts. |

## The science

Cognify isn't vibes-based scoring. Each dimension is anchored to text-observable behavior from
established frameworks — full citations in
[`skill/reference/scientific-basis.md`](skill/reference/scientific-basis.md).

| Dimension | Grounded in | What it observes |
|-----------|-------------|------------------|
| **Critical thinking** | Paul–Elder standards · epistemic vigilance (Sperber et al. 2010) · Watson–Glaser | Assumptions made explicit, evidence requested, counterarguments weighed |
| **Depth** | SOLO taxonomy (Biggs & Collis 1982) · Bloom's revised · Levels of Processing | Isolated facts → integrated, generalized reasoning |
| **Engagement** | ICAP framework (Chi & Wylie 2014) · Need for Cognition | Restating → building on and extending ideas |
| **Offloading ratio** | Cognitive offloading (Sparrow 2011; Risko & Gilbert 2016) | Work delegated to AI vs. retained and verified |

## Install the skill (Claude Code)

Symlink the skill into your Claude Code skills directory:

```bash
git clone https://github.com/<you>/cognify.git
ln -s "$(pwd)/cognify/skill" ~/.claude/skills/cognify
```

Then, in any conversation, just say **"score my thinking"** (or **"cognify"**).
Requires Node ≥18 so the skill can persist your profile.

## View your profile

```bash
cd app && npm install && npm run dev
```

Open the dashboard → **Profile → Import profile.json** → choose `~/.cognify/profile.json`.
A built-in **Demo** runs with zero setup if you just want to look around.

## Privacy

Everything stays on your machine. Cognify stores **labels + scores + signals** in
`~/.cognify/profile.json` — never your raw transcripts, unless you explicitly opt in.

## Roadmap

- ✅ **v1** — on-demand skill + local profile + dashboard
- ✅ **Phase 2** — auto-score on session end via a `SessionEnd` hook ([`skill/hooks/`](skill/hooks/cognify-autoscore.md))
- ✅ **Relaunch** — public web analyzer: paste a transcript, get a report (`app/` + `api/`)
- 🔜 **Phase 3** — claude.ai Skills wrapper (reuses `SKILL.md` + `schema.json`)
- 🔭 **Phase 4** — hosted accounts and a research arm studying how AI shapes thinking,
  built on Cognify's unique behavioral, longitudinal dataset

## Repository layout

```text
cognify/
├── skill/        # the Claude skill: SKILL.md, store script, schema + science
│   └── hooks/    # Phase-2 auto-scoring: SessionEnd hook + guide
├── app/          # React web app: public analyzer + local dashboard
├── api/          # serverless scoring endpoint (Anthropic SDK, rate-limited)
│   └── _lib/     # dependency-free analyzer core (prompt, schema, validation)
└── *.html        # showcase: pitch, slides, demo, explainer
```

Everything shares one contract: [`skill/reference/schema.json`](skill/reference/schema.json).
A session scored on the website downloads as the same JSON the Claude Code skill writes to
`~/.cognify/profile.json`, and both import into the dashboard.

## Development

```bash
npm install     # root: Anthropic SDK for the API function
npm test        # store + analyzer + API handler tests (node:test, no framework)
npm run build   # dashboard/analyzer build (Vite)
```

## License

[MIT](LICENSE) — built with care, and a little help from Claude.
