import React, { useState, useEffect, useCallback } from 'react';

// ─── SAMPLE CONTENT ──────────────────────────────────────────────────────
// The sample report is precomputed so it renders instantly, costs nothing,
// and works on deployments with no API key. It is labeled as a sample in the
// UI. Live scoring goes through POST /api/analyze (see api/analyze.mjs).

const SAMPLE_CONVERSATION = [
  "User: I've been reading that AI tools like ChatGPT are basically making us all smarter. Everyone's productivity is through the roof.",
  "",
  "Assistant: There are certainly productivity gains documented with AI tools, though the research is nuanced. Some studies show efficiency improvements, while others raise concerns about skill atrophy in certain domains.",
  "",
  "User: Yeah I saw that too. Plus I read that taking vitamin D supplements can cure depression — my friend switched and says she feels way better.",
  "",
  "Assistant: The relationship between vitamin D and mood is complex. Some studies show correlations with mood disorders in deficiency cases, but 'cure' is a strong claim. Clinical depression typically requires professional diagnosis and treatment.",
  "",
  "User: Makes sense. But I think the AI productivity thing is definitely true — I mean look at how much faster people are coding now. The data speaks for itself.",
  "",
  "Assistant: Productivity data in software development does show acceleration for certain tasks. Though it's worth noting the variance — AI excels at boilerplate but struggles with novel architectural decisions.",
  "",
  "User: Interesting. And what about the 5G conspiracy stuff — I know that's fake but my neighbor keeps sending me articles. How do I push back effectively?",
  "",
  "Assistant: Great instinct to question it. The 5G conspiracy claims lack peer-reviewed support and contradict established physics. You can point to specific frequency ranges and their interaction with biological tissue — the energy levels are far too low for the claimed effects.",
  "",
  "User: Okay that's helpful. I'm going to look into the productivity research more — what metrics actually matter when evaluating these claims?"
].join("\n");

const SAMPLE_SESSION = {
  id: 'session-sample',
  timestamp: null, // stamped when loaded
  source: 'manual',
  conversation: 'AI productivity and health claims',
  scores: { criticalThinking: 56, depth: 61, engagement: 78 },
  offloadingRatio: 52,
  claims: [
    { text: 'AI tools are making everyone smarter and more productive', risk: 'medium', tag: 'ai/productivity' },
    { text: 'Vitamin D supplements can cure depression', risk: 'high', tag: 'health' },
    { text: 'The productivity data speaks for itself', risk: 'medium', tag: 'reasoning' },
    { text: '5G conspiracy claims lack scientific basis', risk: 'low', tag: 'science' },
  ],
  topics: ['ai', 'productivity', 'health', 'supplements', '5g'],
  engagementSignals: [
    'Asks clarifying follow-up questions',
    'Seeks explanation of mechanisms',
    'Accepts health claims without requesting evidence',
    'Appropriately doubts conspiracy content',
    'Closes by requesting evaluation criteria',
  ],
  summary: 'Strong engagement with AI and productivity topics, with well-structured questions. Critical scrutiny drops around health claims, which are accepted at face value. Skepticism toward fringe science is well calibrated, and the session ends with a notably metacognitive request for evaluation criteria.',
  rubricVersion: '1.0',
};

const SAMPLE_SESSIONS_SEED = [
  {
    id: 'seed-1',
    timestamp: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(),
    conversation: 'Nutrition myths and diet trends',
    scores: { criticalThinking: 42, depth: 55, engagement: 71 },
    offloadingRatio: 68,
    claims: [
      { text: 'Cutting carbs completely leads to faster weight loss', risk: 'high', tag: 'nutrition' },
      { text: 'Intermittent fasting has no downsides for everyone', risk: 'medium', tag: 'health' },
    ],
    topics: ['nutrition', 'diet', 'health'],
    engagementSignals: ['accepts health claims without verification', 'no source requests'],
    summary: 'High engagement with nutrition topics but claims accepted with minimal skepticism.',
  },
  {
    id: 'seed-2',
    timestamp: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    conversation: 'AI productivity tools and automation',
    scores: { criticalThinking: 58, depth: 67, engagement: 83 },
    offloadingRatio: 55,
    claims: [
      { text: 'AI will replace 80% of jobs within 5 years', risk: 'high', tag: 'ai/future' },
      { text: 'Automation always increases net efficiency', risk: 'medium', tag: 'productivity' },
    ],
    topics: ['ai', 'productivity', 'automation', 'jobs'],
    engagementSignals: ['asks clarifying questions', 'references external sources'],
    summary: 'Improving critical engagement; probes assumptions but accepts some generalisations.',
  },
  {
    id: 'seed-3',
    timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    conversation: 'Health supplements and wellness trends',
    scores: { criticalThinking: 51, depth: 61, engagement: 78 },
    offloadingRatio: 60,
    claims: [
      { text: 'Natural supplements are always safer than pharmaceuticals', risk: 'high', tag: 'health' },
      { text: 'Natural remedies have no significant side effects', risk: 'high', tag: 'health' },
    ],
    topics: ['health', 'supplements', 'wellness'],
    engagementSignals: ['asks for sources occasionally', 'accepts health generalisations'],
    summary: 'Continued low skepticism toward supplement claims; slight improvement in questioning.',
  },
];

const MAX_TRANSCRIPT_CHARS = 24000;
const MIN_TRANSCRIPT_CHARS = 80;

// ─── API ─────────────────────────────────────────────────────────────────

async function analyzeTranscript(transcript) {
  let resp;
  try {
    resp = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript }),
    });
  } catch {
    throw new Error('Could not reach the analyzer. If you are viewing a static build without a backend, use the sample report instead.');
  }
  let data = null;
  try { data = await resp.json(); } catch { /* non-JSON error body */ }
  if (!resp.ok) {
    throw new Error((data && data.error) || `Scoring failed (HTTP ${resp.status}). Try again shortly.`);
  }
  return data.session;
}

// ─── STORAGE WRAPPER ──────────────────────────────────────────────────────

let _memStore = {};
let _storageUnavailable = false;

function getStore() {
  if (typeof window !== 'undefined' && window.storage && typeof window.storage.getItem === 'function') {
    return window.storage;
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem('__cognify_test__', '1');
      window.localStorage.removeItem('__cognify_test__');
      return window.localStorage;
    } catch {
      // fall through to in-memory
    }
  }
  _storageUnavailable = true;
  return {
    getItem: (k) => _memStore[k] ?? null,
    setItem: (k, v) => { _memStore[k] = v; },
    removeItem: (k) => { delete _memStore[k]; },
  };
}

function storageGet(key) {
  try {
    const val = getStore().getItem(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    getStore().setItem(key, JSON.stringify(value));
  } catch {
    // silent
  }
}

// ─── PROFILE AGGREGATION ─────────────────────────────────────────────────

function aggregateProfile(sessions) {
  if (!sessions || !sessions.length) return null;

  const topicFrequency = {};
  let totalCT = 0;
  let totalDepth = 0;
  const trend = [];
  const allClaims = [];
  let totalOffload = 0;
  let offloadCount = 0;

  for (const s of sessions) {
    for (const t of (s.topics || [])) {
      topicFrequency[t] = (topicFrequency[t] || 0) + 1;
    }
    totalCT += s.scores.criticalThinking;
    totalDepth += s.scores.depth;
    trend.push({
      date: new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      criticalThinking: s.scores.criticalThinking,
      depth: s.scores.depth,
    });
    allClaims.push(...(s.claims || []));
    if (typeof s.offloadingRatio === 'number') {
      totalOffload += s.offloadingRatio;
      offloadCount += 1;
    }
  }

  const blindspotTags = allClaims.filter(c => c.risk === 'high').map(c => c.tag);
  const strengthTags = allClaims.filter(c => c.risk === 'low').map(c => c.tag);

  return {
    topicFrequency,
    avgCriticalThinking: Math.round(totalCT / sessions.length),
    avgDepth: Math.round(totalDepth / sessions.length),
    blindspots: [...new Set(blindspotTags)],
    strengths: [...new Set(strengthTags)],
    trend,
    sessionCount: sessions.length,
    avgOffloadingRatio: offloadCount ? Math.round(totalOffload / offloadCount) : null,
  };
}

// ─── FINGERPRINT GENERATION ──────────────────────────────────────────────

function generateFingerprint(profile) {
  if (!profile) return '';

  const topTopics = Object.entries(profile.topicFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);

  const ctLevel =
    profile.avgCriticalThinking >= 70 ? 'strong' :
    profile.avgCriticalThinking >= 50 ? 'moderate' : 'developing';

  const depthDesc = profile.avgDepth > 60 ? 'substantive' : 'surface-level';

  const blindspotText = profile.blindspots.length
    ? `You show a recurring pattern of reduced scrutiny around ${profile.blindspots.slice(0, 2).map(b => `"${b}"`).join(' and ')} claims`
    : 'No consistent blind spots have emerged yet';

  const strengthText = profile.strengths.length
    ? ` Your skepticism is well-calibrated toward ${profile.strengths.slice(0, 2).join(' and ')} content.`
    : '';

  const trend = profile.trend;
  const improving = trend.length >= 2 &&
    trend[trend.length - 1].criticalThinking > trend[0].criticalThinking;

  return [
    `You engage most deeply with ${topTopics.join(', ')} topics, where your critical thinking is most active and your questioning most structured.`,
    `Across ${profile.sessionCount} session${profile.sessionCount !== 1 ? 's' : ''}, your critical thinking registers as ${ctLevel} (avg ${profile.avgCriticalThinking}/100) with a depth score of ${profile.avgDepth}/100 — indicating ${depthDesc} exploration of ideas.`,
    `${blindspotText} — these are areas where epistemic vigilance may be worth consciously raising.${strengthText}`,
    improving
      ? 'Your critical thinking trend is improving over time — you are asking better, more precise questions with each session.'
      : 'Consistent engagement across sessions suggests stable cognitive habits.',
  ].join(' ');
}

// ─── COMPONENTS ──────────────────────────────────────────────────────────

// The five bands of the rubric ladder (ICAP / SOLO / Bloom composite) that the
// scoring actually uses — see skill/reference/scientific-basis.md.
const BANDS = [
  { max: 20, label: 'Passive' },
  { max: 40, label: 'Active' },
  { max: 60, label: 'Constructive' },
  { max: 80, label: 'Relational' },
  { max: 100, label: 'Interactive' },
];

function bandFor(value) {
  return BANDS.find(b => value <= b.max) || BANDS[BANDS.length - 1];
}

// Signature element: a score shown as its position on the five-band rubric
// ladder. Each cell fills to the extent the score covers it (2px gaps between
// cells; monochrome fill).
function BandGauge({ value, label, sublabel, showBand = true }) {
  const v = Math.min(100, Math.max(0, value));
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-2">{label}</span>
        <span className="font-mono text-2xl font-semibold text-white tabular-nums">{v}</span>
      </div>
      <div className="flex gap-[2px]" role="img" aria-label={`${label}: ${v} out of 100`}>
        {BANDS.map((b, i) => {
          const lo = i * 20;
          const fillPct = Math.min(1, Math.max(0, (v - lo) / 20));
          return (
            <div key={b.label} className="flex-1 h-2 bg-[#1c1c1c] overflow-hidden">
              <div
                className="h-full bg-white"
                style={{ width: `${fillPct * 100}%`, transition: 'width 0.7s ease' }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-3">
        {showBand ? bandFor(v).label : sublabel}
      </div>
    </div>
  );
}

// Risk is status information: encoded by treatment + icon + label, never color.
const RISK_CFG = {
  high:   { icon: '▲', label: 'HIGH RISK', wrap: 'bg-white text-black border border-white',           tag: 'text-neutral-600' },
  medium: { icon: '◆', label: 'MEDIUM',    wrap: 'bg-transparent text-neutral-200 border border-neutral-600', tag: 'text-ink-3' },
  low:    { icon: '○', label: 'VERIFIED',  wrap: 'bg-transparent text-ink-3 border border-hairline',  tag: 'text-ink-3' },
};

function ClaimBadge({ claim }) {
  const cfg = RISK_CFG[claim.risk] || RISK_CFG.medium;
  return (
    <div className={`${cfg.wrap} p-3 flex items-start gap-3`}>
      <span className="font-mono text-[10px] mt-0.5 flex-shrink-0" aria-hidden="true">{cfg.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug">{claim.text}</p>
        <div className="flex items-center gap-3 mt-1.5 font-mono text-[10px] uppercase tracking-widest">
          <span className="font-semibold">{cfg.label}</span>
          <span className={cfg.tag}>#{claim.tag}</span>
        </div>
      </div>
    </div>
  );
}

function TrendChart({ trend }) {
  if (!trend || trend.length < 2) {
    return (
      <div className="h-36 flex items-center justify-center text-ink-3 text-sm">
        Need at least 2 sessions for a trend
      </div>
    );
  }

  const W = 480;
  const H = 130;
  const PAD = { top: 12, right: 110, bottom: 24, left: 28 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const allVals = trend.flatMap(t => [t.criticalThinking, t.depth]);
  const minV = Math.max(0, Math.min(...allVals) - 10);
  const maxV = Math.min(100, Math.max(...allVals) + 10);

  const xAt = (i) => PAD.left + (i / (trend.length - 1)) * innerW;
  const yAt = (v) => PAD.top + innerH - ((v - minV) / (maxV - minV)) * innerH;

  const pathFor = (key) =>
    trend.map((t, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(t[key]).toFixed(1)}`).join(' ');

  const last = trend[trend.length - 1];

  // Two series in monochrome: identity by line pattern (solid vs dashed) plus
  // direct end labels — never color alone.
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: '150px' }}>
        {[25, 50, 75].map(v => (
          (v >= minV && v <= maxV) && (
            <React.Fragment key={v}>
              <line
                x1={PAD.left} x2={W - PAD.right}
                y1={yAt(v)} y2={yAt(v)}
                stroke="#1c1c1c" strokeWidth="1" />
              <text x={PAD.left - 6} y={yAt(v) + 3}
                textAnchor="end" fill="#525252" fontSize="9" fontFamily="IBM Plex Mono, monospace">{v}</text>
            </React.Fragment>
          )
        ))}
        <path d={pathFor('criticalThinking')} fill="none" stroke="#ffffff" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" />
        <path d={pathFor('depth')} fill="none" stroke="#8a8a8a" strokeWidth="2" strokeDasharray="5 4"
          strokeLinecap="round" strokeLinejoin="round" />
        {trend.map((t, i) => (
          <React.Fragment key={i}>
            <circle cx={xAt(i)} cy={yAt(t.criticalThinking)} r="3" fill="#ffffff">
              <title>{`${t.date} — critical thinking ${t.criticalThinking}`}</title>
            </circle>
            <circle cx={xAt(i)} cy={yAt(t.depth)} r="3" fill="#0a0a0a" stroke="#8a8a8a" strokeWidth="1.5">
              <title>{`${t.date} — depth ${t.depth}`}</title>
            </circle>
            <text x={xAt(i)} y={H - 6} textAnchor="middle" fill="#525252" fontSize="9"
              fontFamily="IBM Plex Mono, monospace">
              {t.date}
            </text>
          </React.Fragment>
        ))}
        <text x={W - PAD.right + 8} y={yAt(last.criticalThinking) + 3} fill="#ffffff" fontSize="9"
          fontFamily="IBM Plex Mono, monospace">CRITICAL THINKING</text>
        <text x={W - PAD.right + 8} y={yAt(last.depth) + 3} fill="#8a8a8a" fontSize="9"
          fontFamily="IBM Plex Mono, monospace">DEPTH</text>
      </svg>
      <div className="flex gap-6 mt-1 font-mono text-[10px] uppercase tracking-widest text-ink-3">
        <span className="flex items-center gap-2">
          <span className="w-5 border-t-2 border-white inline-block" />
          Critical thinking
        </span>
        <span className="flex items-center gap-2">
          <span className="w-5 border-t-2 border-dashed border-neutral-500 inline-block" />
          Depth
        </span>
      </div>
    </div>
  );
}

function TopicMap({ topicFrequency }) {
  if (!topicFrequency || !Object.keys(topicFrequency).length) {
    return <p className="text-ink-3 text-sm">No topics yet.</p>;
  }
  const sorted = Object.entries(topicFrequency).sort((a, b) => b[1] - a[1]);
  const maxCount = sorted[0][1];

  const cls = (count) => {
    const ratio = count / maxCount;
    if (ratio > 0.75) return 'border-white text-white';
    if (ratio > 0.4)  return 'border-neutral-600 text-neutral-300';
    return 'border-hairline text-ink-3';
  };

  return (
    <div className="flex flex-wrap gap-2">
      {sorted.map(([topic, count]) => (
        <span key={topic}
          className={`border font-mono text-xs px-2.5 py-1 ${cls(count)} flex items-center gap-1.5`}>
          {topic}
          <span className="opacity-50">{count}</span>
        </span>
      ))}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function SectionLabel({ children }) {
  return (
    <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-3 mb-4">{children}</h2>
  );
}

function Panel({ children, className = '' }) {
  return (
    <div className={`border border-hairline bg-surface-2 p-5 ${className}`}>{children}</div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState('home');
  const [conversation, setConversation] = useState('');
  const [result, setResult] = useState(null);       // a session object
  const [isSample, setIsSample] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [storageWarn, setStorageWarn] = useState(false);

  useEffect(() => {
    const stored = storageGet('sessions');
    if (stored && Array.isArray(stored)) setSessions(stored);
    if (_storageUnavailable) setStorageWarn(true);
  }, []);

  const persistSession = useCallback((session) => {
    setSessions(prev => {
      const next = [...prev, session];
      storageSet('sessions', next);
      const profile = aggregateProfile(next);
      if (profile) {
        storageSet('profile', profile);
        storageSet('fingerprint', generateFingerprint(profile));
      }
      return next;
    });
  }, []);

  const handleImport = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const imported = Array.isArray(data) ? data : data.sessions;
        if (!Array.isArray(imported)) throw new Error('no sessions array');
        const valid = imported.every(s =>
          s && s.scores &&
          typeof s.scores.criticalThinking === 'number' &&
          typeof s.scores.depth === 'number');
        if (!valid) throw new Error('invalid session shape');
        setSessions(imported);
        storageSet('sessions', imported);
        setError(null);
      } catch {
        setError('Could not import — expected a Cognify profile.json file (from ~/.cognify or a downloaded session).');
      }
    };
    reader.readAsText(file);
  }, []);

  const handleAnalyze = useCallback(async () => {
    const transcript = conversation.trim();
    if (!transcript) return;
    if (transcript.length < MIN_TRANSCRIPT_CHARS) {
      setError(`That's too short to score — paste at least ${MIN_TRANSCRIPT_CHARS} characters of conversation.`);
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setIsSample(false);
    try {
      const session = await analyzeTranscript(transcript);
      setResult(session);
      persistSession(session);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [conversation, persistSession]);

  const handleSample = useCallback(() => {
    setConversation(SAMPLE_CONVERSATION);
    setError(null);
    setLoading(false);
    const session = { ...SAMPLE_SESSION, id: `session-sample-${Date.now()}`, timestamp: new Date().toISOString() };
    const seeded = [...SAMPLE_SESSIONS_SEED, session];
    storageSet('sessions', seeded);
    setSessions(seeded);
    const profile = aggregateProfile(seeded);
    if (profile) {
      storageSet('profile', profile);
      storageSet('fingerprint', generateFingerprint(profile));
    }
    setResult(session);
    setIsSample(true);
  }, []);

  const handleSampleFromHome = useCallback(() => {
    setView('analyze');
    setTimeout(() => handleSample(), 30);
  }, [handleSample]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const blob = new Blob([JSON.stringify({ version: 1, sessions: [result] }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cognify-${result.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const profile = aggregateProfile(sessions);
  const fingerprint = generateFingerprint(profile);
  const charCount = conversation.length;
  const overLimit = charCount > MAX_TRANSCRIPT_CHARS;

  return (
    <div className="min-h-screen bg-surface text-neutral-100">
      {storageWarn && (
        <div className="border-b border-hairline px-4 py-2 font-mono text-[11px] text-ink-2 text-center">
          Storage unavailable — session data is in-memory only and will not persist across reloads.
        </div>
      )}

      {/* Header */}
      <header className="border-b border-hairline px-6 py-4 flex items-center justify-between sticky top-0 bg-surface/95 backdrop-blur-sm z-50">
        <button onClick={() => setView('home')} className="flex items-center gap-3 hover:opacity-70 transition-opacity">
          <span className="w-3 h-3 bg-white inline-block" aria-hidden="true" />
          <span className="font-mono font-semibold tracking-[0.25em] text-sm text-white">COGNIFY</span>
        </button>

        <nav className="flex items-center gap-1 font-mono text-xs uppercase tracking-widest">
          {[['analyze', 'Score'], ['profile', 'Profile']].map(([key, label]) => (
            <button key={key}
              onClick={() => setView(key)}
              className={`px-4 py-1.5 transition-colors ${
                view === key
                  ? 'bg-white text-black'
                  : 'text-ink-3 hover:text-white'
              }`}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">

        {/* ── HOME VIEW ───────────────────────────────────────────── */}
        {view === 'home' && (
          <div>
            {/* Hero */}
            <div className="pt-20 pb-16 border-b border-hairline">
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-ink-3 mb-6">
                Cognitive measurement · rubric v1.0
              </p>
              <h1 className="font-display text-5xl sm:text-7xl font-bold text-white leading-[0.95] tracking-tight mb-8">
                Your thinking,<br />measured.
              </h1>
              <p className="text-lg text-ink-2 max-w-xl leading-relaxed mb-10">
                We track steps and sleep. Nothing tracks how you think with AI.
                Cognify scores a conversation transcript against a rubric grounded in
                cognitive science — in seconds, no sign-up.
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => setView('analyze')}
                  className="bg-white text-black hover:bg-neutral-200 font-mono text-xs uppercase tracking-widest font-semibold px-7 py-3.5 transition-colors">
                  Score a transcript
                </button>
                <button
                  onClick={handleSampleFromHome}
                  className="border border-neutral-600 hover:border-white text-neutral-300 hover:text-white font-mono text-xs uppercase tracking-widest px-7 py-3.5 transition-colors">
                  View sample report
                </button>
              </div>
            </div>

            {/* What it measures — the real gauges */}
            <div className="py-14 border-b border-hairline">
              <SectionLabel>What it measures</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-8 mt-6">
                <div>
                  <BandGauge value={56} label="Critical thinking" />
                  <p className="text-xs text-ink-3 leading-relaxed mt-2">
                    Do you challenge and evaluate claims, or accept them at face value?
                  </p>
                </div>
                <div>
                  <BandGauge value={61} label="Depth" />
                  <p className="text-xs text-ink-3 leading-relaxed mt-2">
                    Isolated facts, or integrated reasoning that connects ideas?
                  </p>
                </div>
                <div>
                  <BandGauge value={78} label="Engagement" />
                  <p className="text-xs text-ink-3 leading-relaxed mt-2">
                    Restating what you're told, or building on and extending it?
                  </p>
                </div>
                <div>
                  <BandGauge value={52} label="Offloading ratio" showBand={false}
                    sublabel="Signature metric — lower is healthier" />
                  <p className="text-xs text-ink-3 leading-relaxed mt-2">
                    How much of the cognitive work you delegate to the AI versus retain and verify.
                  </p>
                </div>
              </div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-ink-3 mt-8">
                Scored on the five-band rubric ladder: Passive · Active · Constructive · Relational · Interactive
              </p>
            </div>

            {/* How it works — a real sequence */}
            <div className="py-14 border-b border-hairline">
              <SectionLabel>How it works</SectionLabel>
              <div className="space-y-0 mt-2">
                {[
                  { n: '01', title: 'Paste a transcript', body: 'Any conversation with an AI assistant. It is scored, not stored.' },
                  { n: '02', title: 'Read your report', body: 'Four scores on the rubric ladder, claims flagged by epistemic risk, and the behavioral signals behind them.' },
                  { n: '03', title: 'Watch the pattern', body: 'Each report adds to a local profile: trends, blind spots, and a plain-English cognitive fingerprint.' },
                ].map(({ n, title, body }, i) => (
                  <div key={n} className={`flex items-start gap-6 py-5 ${i > 0 ? 'border-t border-hairline' : ''}`}>
                    <span className="font-mono text-xs text-ink-3 pt-0.5 flex-shrink-0">{n}</span>
                    <div>
                      <h3 className="font-display text-base font-bold text-white mb-1">{title}</h3>
                      <p className="text-sm text-ink-2 leading-relaxed">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Sample fingerprint */}
            <div className="py-14 border-b border-hairline">
              <SectionLabel>Specimen — cognitive fingerprint</SectionLabel>
              <blockquote className="border-l-2 border-white pl-6 mt-6">
                <p className="text-base text-neutral-200 leading-relaxed">
                  "You engage most deeply with <strong>AI, productivity, and health</strong> topics.
                  You show a recurring pattern of reduced scrutiny around <strong>health claims</strong> —
                  areas where epistemic vigilance may be worth consciously raising. Your skepticism is
                  well-calibrated toward <strong>science content</strong>, and your critical thinking
                  trend is improving — you ask better questions with each session."
                </p>
              </blockquote>
            </div>

            {/* Claim risk sample */}
            <div className="py-14 border-b border-hairline">
              <SectionLabel>Claim risk detection</SectionLabel>
              <div className="space-y-2 mt-6">
                <ClaimBadge claim={{ text: 'Vitamin D supplements can cure depression', risk: 'high', tag: 'health' }} />
                <ClaimBadge claim={{ text: 'AI tools are making everyone smarter', risk: 'medium', tag: 'ai/productivity' }} />
                <ClaimBadge claim={{ text: '5G conspiracy claims lack scientific basis', risk: 'low', tag: 'science' }} />
              </div>
            </div>

            {/* Bottom CTA */}
            <div className="py-16 text-center">
              <h2 className="font-display text-2xl font-bold text-white mb-3">See your score.</h2>
              <p className="text-ink-2 text-sm mb-8">
                Grounded in ICAP, SOLO, Paul–Elder, and cognitive-offloading research.
              </p>
              <button
                onClick={handleSampleFromHome}
                className="bg-white text-black hover:bg-neutral-200 font-mono text-xs uppercase tracking-widest font-semibold px-10 py-3.5 transition-colors">
                View sample report
              </button>
            </div>
          </div>
        )}

        {/* ── ANALYZE VIEW ────────────────────────────────────────── */}
        {view === 'analyze' && (
          <div className="space-y-6">
            <div>
              <h1 className="font-display text-2xl font-bold text-white">Score a transcript</h1>
              <p className="text-sm text-ink-2 mt-1">
                Paste a conversation with an AI assistant. Scoring is rate-limited; transcripts are scored, not stored.
              </p>
            </div>

            {/* Input */}
            <div className="space-y-3">
              <textarea
                value={conversation}
                onChange={e => setConversation(e.target.value)}
                placeholder={"Paste a conversation transcript here...\n\nFormat: User: ... / Assistant: ..."}
                className="w-full h-52 bg-surface-2 border border-hairline p-4 font-mono text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-white transition-colors"
              />

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={handleAnalyze}
                  disabled={loading || !conversation.trim() || overLimit}
                  className="flex items-center gap-2 bg-white text-black hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed font-mono text-xs uppercase tracking-widest font-semibold px-6 py-3 transition-colors">
                  {loading && <Spinner />}
                  {loading ? 'Scoring…' : 'Score'}
                </button>

                <button
                  onClick={handleSample}
                  disabled={loading}
                  className="border border-neutral-600 hover:border-white text-neutral-300 hover:text-white font-mono text-xs uppercase tracking-widest px-6 py-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  Load sample
                </button>

                <span className={`font-mono text-[11px] ml-auto tabular-nums ${overLimit ? 'text-white font-semibold' : 'text-ink-3'}`}>
                  {charCount.toLocaleString('en-US')} / {MAX_TRANSCRIPT_CHARS.toLocaleString('en-US')}
                </span>
              </div>
              {overLimit && (
                <p className="font-mono text-[11px] text-neutral-300">
                  Over the limit — trim the transcript to {MAX_TRANSCRIPT_CHARS.toLocaleString('en-US')} characters to score it.
                </p>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="border-l-2 border-white bg-surface-2 border-y border-r border-y-hairline border-r-hairline p-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-ink-3 mb-1">Could not score</p>
                <p className="text-sm text-neutral-200">{error}</p>
              </div>
            )}

            {/* Report */}
            {result && !loading && (
              <div className="space-y-5" style={{ animation: 'fadeIn 0.3s ease' }}>
                <div className="flex items-baseline justify-between flex-wrap gap-2 border-t-2 border-white pt-4">
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-white">
                    {isSample ? 'Sample report' : 'Report'} — {result.conversation}
                  </h2>
                  <span className="font-mono text-[10px] text-ink-3">
                    {isSample ? 'precomputed sample' : `scored ${new Date(result.timestamp).toLocaleString()}`}
                  </span>
                </div>

                {/* Scores */}
                <Panel>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-7">
                    <BandGauge value={result.scores.criticalThinking} label="Critical thinking" />
                    <BandGauge value={result.scores.depth} label="Depth" />
                    <BandGauge value={result.scores.engagement} label="Engagement" />
                    {typeof result.offloadingRatio === 'number' && (
                      <BandGauge value={result.offloadingRatio} label="Offloading ratio" showBand={false}
                        sublabel="Lower is healthier — you stay in the reasoning loop" />
                    )}
                  </div>
                </Panel>

                {/* Summary */}
                <Panel>
                  <SectionLabel>Summary</SectionLabel>
                  <p className="text-sm text-neutral-200 leading-relaxed">{result.summary}</p>
                </Panel>

                {/* Claims */}
                {result.claims.length > 0 && (
                  <Panel>
                    <SectionLabel>Flagged claims</SectionLabel>
                    <div className="space-y-2">
                      {result.claims.map((c, i) => <ClaimBadge key={i} claim={c} />)}
                    </div>
                  </Panel>
                )}

                {/* Engagement signals */}
                {result.engagementSignals.length > 0 && (
                  <Panel>
                    <SectionLabel>Observed signals</SectionLabel>
                    <ul className="space-y-1.5">
                      {result.engagementSignals.map((s, i) => (
                        <li key={i} className="flex items-start gap-3 text-sm text-ink-2">
                          <span className="font-mono text-ink-3 flex-shrink-0">—</span>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </Panel>
                )}

                {/* Actions */}
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleDownload}
                    className="border border-neutral-600 hover:border-white text-neutral-300 hover:text-white font-mono text-[11px] uppercase tracking-widest px-5 py-2.5 transition-colors">
                    Download session JSON
                  </button>
                  <span className="text-xs text-ink-3">
                    Works with the Cognify dashboard and the Claude Code skill's profile.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PROFILE VIEW ────────────────────────────────────────── */}
        {view === 'profile' && (
          <div className="space-y-6">
            <div>
              <h1 className="font-display text-2xl font-bold text-white">Profile</h1>
              <p className="text-sm text-ink-2 mt-1">
                Cumulative patterns across all sessions — stored locally in your browser.
              </p>
              <label className="inline-block mt-2 font-mono text-[11px] uppercase tracking-widest text-ink-2 hover:text-white cursor-pointer border-b border-neutral-600 hover:border-white transition-colors">
                Import profile.json
                <input type="file" accept="application/json,.json" onChange={handleImport} className="hidden" />
              </label>
            </div>

            {error && view === 'profile' && (
              <div className="border-l-2 border-white bg-surface-2 p-4 text-sm text-neutral-200">{error}</div>
            )}

            {!profile ? (
              <div className="border border-hairline p-10 text-center">
                <p className="text-ink-2 text-sm">No sessions yet.</p>
                <p className="text-ink-3 text-xs mt-1">
                  Score a transcript, load the sample, or import a profile.json from the Claude Code skill (~/.cognify).
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Stats row */}
                <div className="grid grid-cols-3 gap-px bg-hairline border border-hairline">
                  {[
                    { label: 'Sessions', value: profile.sessionCount },
                    { label: 'Avg critical thinking', value: profile.avgCriticalThinking },
                    { label: 'Avg depth', value: profile.avgDepth },
                  ].map(stat => (
                    <div key={stat.label} className="bg-surface-2 p-4 text-center">
                      <div className="font-mono text-3xl font-semibold text-white tabular-nums">{stat.value}</div>
                      <div className="font-mono text-[10px] uppercase tracking-widest text-ink-3 mt-1">{stat.label}</div>
                    </div>
                  ))}
                </div>

                {profile.avgOffloadingRatio !== null && (
                  <Panel>
                    <div className="max-w-md">
                      <BandGauge value={profile.avgOffloadingRatio} label="Avg offloading ratio" showBand={false}
                        sublabel="Lower is healthier — you stay in the reasoning loop" />
                    </div>
                  </Panel>
                )}

                {/* Trend chart */}
                <Panel>
                  <SectionLabel>Score trend</SectionLabel>
                  <TrendChart trend={profile.trend} />
                </Panel>

                {/* Topic map */}
                <Panel>
                  <SectionLabel>Topic map</SectionLabel>
                  <TopicMap topicFrequency={profile.topicFrequency} />
                </Panel>

                {/* Blindspots + Strengths */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Panel>
                    <SectionLabel>▲ Blind spots</SectionLabel>
                    {profile.blindspots.length ? (
                      <div className="flex flex-wrap gap-2">
                        {profile.blindspots.map(b => (
                          <span key={b} className="font-mono text-xs bg-white text-black px-2.5 py-1">
                            {b}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-ink-3">None detected yet.</p>
                    )}
                  </Panel>
                  <Panel>
                    <SectionLabel>○ Strengths</SectionLabel>
                    {profile.strengths.length ? (
                      <div className="flex flex-wrap gap-2">
                        {profile.strengths.map(s => (
                          <span key={s} className="font-mono text-xs border border-neutral-500 text-neutral-300 px-2.5 py-1">
                            {s}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-ink-3">Not enough data yet.</p>
                    )}
                  </Panel>
                </div>

                {/* Fingerprint */}
                <div className="border-l-2 border-white bg-surface-2 border-y border-r border-y-hairline border-r-hairline p-5">
                  <SectionLabel>Cognitive fingerprint</SectionLabel>
                  <p className="text-sm text-neutral-200 leading-relaxed">{fingerprint}</p>
                </div>

                {/* Sessions list */}
                <Panel>
                  <SectionLabel>Session history</SectionLabel>
                  <div className="divide-y divide-hairline">
                    {[...sessions].reverse().map((s) => (
                      <div key={s.id} className="py-3 flex items-center gap-4">
                        <div className="font-mono text-[11px] text-ink-3 w-16 flex-shrink-0">
                          {new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-4 font-mono text-[11px] tabular-nums">
                            <span className="text-white">CT {s.scores.criticalThinking}</span>
                            <span className="text-neutral-400">DP {s.scores.depth}</span>
                            <span className="text-neutral-400">EN {s.scores.engagement}</span>
                            {typeof s.offloadingRatio === 'number' && (
                              <span className="text-ink-3">OFF {s.offloadingRatio}</span>
                            )}
                          </div>
                          <p className="text-xs text-ink-3 mt-0.5 truncate">{s.summary || s.conversation}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-hairline mt-8 px-6 py-6 max-w-4xl mx-auto w-full flex items-center justify-between flex-wrap gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-3">
          Cognify · open source · rubric v1.0
        </span>
        <a href="https://github.com/krisparashkevov17/cognify" target="_blank" rel="noreferrer"
          className="font-mono text-[10px] uppercase tracking-widest text-ink-3 hover:text-white transition-colors">
          GitHub ↗
        </a>
      </footer>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
