import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ─── Provider abstraction ────────────────────────────────────────────────────

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';

async function ollamaAvailable() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function getAvailableProviders() {
  const providers = [];
  if (process.env.OPENAI_API_KEY) providers.push('openai');
  if (process.env.ANTHROPIC_API_KEY) providers.push('claude');
  if (await ollamaAvailable()) providers.push('ollama');
  return providers;
}

// Unified chat function — returns content string
async function chat(provider, messages, temperature = 0.3) {
  if (provider === 'openai') {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages,
      temperature,
    });
    return res.choices[0].message.content;
  }

  if (provider === 'claude') {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    // Extract system prompt if present
    const system = messages.find(m => m.role === 'system')?.content || '';
    const userMessages = messages.filter(m => m.role !== 'system');
    const res = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system,
      messages: userMessages,
    });
    return res.content[0].text;
  }

  if (provider === 'ollama') {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
        options: { temperature },
      }),
    });
    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const data = await res.json();
    return data.message?.content || '';
  }

  throw new Error(`Unknown provider: ${provider}`);
}

function resolveProvider(requested, available) {
  if (requested && available.includes(requested)) return requested;
  if (available.length === 0) throw new Error('No AI provider available. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or start Ollama.');
  return available[0];
}

function parseJSON(raw) {
  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

// ─── Reddit helpers ──────────────────────────────────────────────────────────

const REDDIT_HEADERS = {
  'User-Agent': 'RedditLeadGenerator/1.0 (by /u/leadgen)',
  'Accept': 'application/json',
};

async function fetchReddit(url) {
  const res = await fetch(url, { headers: REDDIT_HEADERS });
  if (!res.ok) throw new Error(`Reddit fetch failed: ${res.status} ${url}`);
  return res.json();
}

async function getHotThreads(subreddit, limit = 15) {
  try {
    const data = await fetchReddit(`https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`);
    return (data?.data?.children || []).map(({ data: p }) => ({
      title: p.title,
      url: `https://reddit.com${p.permalink}`,
      score: p.score,
      comments: p.num_comments,
      flair: p.link_flair_text || '',
      author: p.author,
      subreddit: p.subreddit,
      created: new Date(p.created_utc * 1000).toLocaleDateString(),
      selftext_preview: p.selftext?.slice(0, 200) || '',
    }));
  } catch {
    return [];
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/api/providers', async (_req, res) => {
  const available = await getAvailableProviders();
  res.json({ available });
});

// Mode 1: Given post content → AI suggests subreddits → fetch threads → AI ranks them
app.post('/api/find-threads', async (req, res) => {
  const { content, configured_subreddits = [], provider: reqProvider } = req.body;

  if (!content?.trim()) return res.status(400).json({ error: 'Post content is required' });

  try {
    const available = await getAvailableProviders();
    const provider = resolveProvider(reqProvider, available);

    // Step 1: suggest subreddits
    const subRaw = await chat(provider, [
      {
        role: 'system',
        content: `You are a Reddit marketing expert. Given a post/product/service description, suggest the most relevant subreddits where someone could organically participate and promote their content without being spammy.

Return ONLY a JSON array of subreddit names (without r/) — no explanations, no markdown. Example: ["entrepreneur", "startups", "sideprojects"]

Rules:
- Suggest 8-12 subreddits
- Mix of large and niche communities
- Include subreddits where the content would be genuinely useful
- Avoid subreddits with strict no-promotion rules unless the content truly fits organically`,
      },
      { role: 'user', content: `Find the best subreddits for this content:\n\n${content}` },
    ], 0.3);

    let suggestedSubreddits = [];
    try { suggestedSubreddits = parseJSON(subRaw); } catch { suggestedSubreddits = []; }

    const allSubreddits = [...new Set([...configured_subreddits, ...suggestedSubreddits])];

    // Step 2: fetch threads
    const threadResults = await Promise.all(
      allSubreddits.map(async (sub) => {
        const threads = await getHotThreads(sub, 10);
        return { subreddit: sub, threads };
      })
    );

    const allThreads = threadResults.flatMap(({ threads }) => threads);
    if (allThreads.length === 0) return res.json({ subreddits: suggestedSubreddits, results: [], provider });

    // Step 3: rank threads
    const scoreRaw = await chat(provider, [
      {
        role: 'system',
        content: `You are a Reddit growth expert. Given a post/content and a list of active Reddit threads, identify which threads are the best opportunities to engage with (reply, comment, or post).

Return ONLY a JSON array of objects with this exact structure:
[{"index": 0, "score": 85, "reason": "brief reason why this thread is a good fit", "action": "what to do here (reply/post/comment)"}]

Score 0-100. Only include threads with score >= 60. Sort by score descending.`,
      },
      {
        role: 'user',
        content: `My content:\n${content}\n\nThreads:\n${JSON.stringify(
          allThreads.map((t, i) => ({ index: i, title: t.title, subreddit: t.subreddit, comments: t.comments, preview: t.selftext_preview }))
        )}`,
      },
    ], 0.2);

    let scored = [];
    try { scored = parseJSON(scoreRaw); } catch {
      scored = allThreads.map((_, i) => ({ index: i, score: 70, reason: 'Relevant community', action: 'Engage naturally' }));
    }

    const results = scored.map(({ index, score, reason, action }) => ({ ...allThreads[index], score, reason, action }));
    res.json({ subreddits: suggestedSubreddits, results, provider });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Mode 2: Given subreddits → fetch threads → AI ranks them
app.post('/api/subreddit-threads', async (req, res) => {
  const { subreddits, context = '', provider: reqProvider } = req.body;

  if (!subreddits?.length) return res.status(400).json({ error: 'At least one subreddit is required' });

  try {
    const available = await getAvailableProviders();
    const provider = resolveProvider(reqProvider, available);

    const threadResults = await Promise.all(
      subreddits.map(async (sub) => {
        const threads = await getHotThreads(sub.replace(/^r\//, ''), 15);
        return { threads };
      })
    );

    const allThreads = threadResults.flatMap(({ threads }) => threads);
    if (allThreads.length === 0) return res.json({ results: [], provider });

    const systemPrompt = context
      ? `You are a Reddit growth expert. Given a list of active Reddit threads and context about what the user wants to promote, identify the best threads to engage with.\n\nReturn ONLY a JSON array:\n[{"index": 0, "score": 85, "reason": "brief reason", "action": "what to do here"}]\n\nScore 0-100. Only include score >= 55. Sort by score descending.`
      : `You are a Reddit growth expert. Analyze these threads and rank them by engagement opportunity — active discussions, questions, or threads where a helpful response would be valuable.\n\nReturn ONLY a JSON array:\n[{"index": 0, "score": 85, "reason": "why this thread is active/worth engaging", "action": "suggested action"}]\n\nScore 0-100. Only include score >= 55. Sort by score descending.`;

    const userMsg = context
      ? `Context: ${context}\n\nThreads:\n${JSON.stringify(allThreads.map((t, i) => ({ index: i, title: t.title, subreddit: t.subreddit, comments: t.comments, preview: t.selftext_preview })))}`
      : `Threads:\n${JSON.stringify(allThreads.map((t, i) => ({ index: i, title: t.title, subreddit: t.subreddit, comments: t.comments, preview: t.selftext_preview })))}`;

    const scoreRaw = await chat(provider, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ], 0.2);

    let scored = [];
    try { scored = parseJSON(scoreRaw); } catch {
      scored = allThreads.map((_, i) => ({ index: i, score: 70, reason: 'Active thread', action: 'Engage' }));
    }

    const results = scored.map(({ index, score, reason, action }) => ({ ...allThreads[index], score, reason, action }));
    res.json({ results, provider });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Reddit Lead Generator → http://localhost:${PORT}`));
