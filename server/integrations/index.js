// External service adapters. Each one degrades gracefully when not configured:
// the rest of the application keeps working and callers get a typed error.

export class ServiceUnavailable extends Error {
  constructor(service, message, code = 'not_configured') {
    super(message);
    this.service = service;
    this.code = code;
  }
}

// ------------------------------------------------------------------ mail
export function createMailer(config, logger = console) {
  const { provider, resendKey, from } = config.mail;
  const outbox = []; // last messages, used by tests and the console provider
  return {
    provider,
    outbox,
    async send({ to, subject, text }) {
      outbox.push({ to, subject, text, at: new Date().toISOString() });
      if (outbox.length > 50) outbox.shift();
      if (provider === 'resend' && resendKey) {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to, subject, text }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) throw new ServiceUnavailable('mail', `Email provider responded ${r.status}`, 'upstream_error');
        return;
      }
      if (!config.testMode) logger.log(`\n[mail:console] To: ${to}\nSubject: ${subject}\n${text}\n`);
    },
  };
}

// ------------------------------------------------------------------ AI
export function createAI(config, fetchImpl = globalThis.fetch) {
  const a = config.ai;
  const provider = a.provider === 'anthropic' && a.anthropicKey ? 'anthropic' : a.provider === 'openai' && a.openaiKey ? 'openai' : 'none';
  const configured = provider !== 'none';

  async function complete({ system, prompt, maxTokens = 2000, temperature = 0.4 }) {
    if (!configured) throw new ServiceUnavailable('ai', 'No AI provider is configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env.');
    let res;
    try {
      if (provider === 'anthropic') {
        res = await fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': a.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: a.anthropicModel, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: prompt }] }),
          signal: AbortSignal.timeout(a.timeoutMs),
        });
      } else {
        res = await fetchImpl(`${a.openaiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${a.openaiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: a.openaiModel, max_tokens: maxTokens, temperature, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }),
          signal: AbortSignal.timeout(a.timeoutMs),
        });
      }
    } catch (e) {
      throw new ServiceUnavailable('ai', `AI provider unreachable: ${e.message}`, 'network_error');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ServiceUnavailable('ai', `AI provider error ${res.status}: ${body.slice(0, 300)}`, res.status === 429 ? 'rate_limited' : 'upstream_error');
    }
    const data = await res.json();
    const text = provider === 'anthropic'
      ? (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      : data.choices?.[0]?.message?.content || '';
    if (!text) throw new ServiceUnavailable('ai', 'AI provider returned an empty response', 'empty_response');
    return text;
  }

  async function completeJSON(opts) {
    const text = await complete({ ...opts, system: `${opts.system}\nRespond with JSON only. No prose, no markdown fences.` });
    const cleaned = text.replace(/```(?:json)?/g, '').trim();
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (start < 0 || end < start) throw new ServiceUnavailable('ai', 'AI response did not contain JSON', 'bad_output');
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { throw new ServiceUnavailable('ai', 'AI response JSON could not be parsed', 'bad_output'); }
  }

  return { configured, provider, model: provider === 'anthropic' ? a.anthropicModel : provider === 'openai' ? a.openaiModel : null, complete, completeJSON };
}

// ------------------------------------------------------------------ YouTube
export function parseYouTubeId(input) {
  const s = String(input || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (/(^|\.)youtu\.be$/.test(u.hostname)) return u.pathname.slice(1, 12) || null;
    if (/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) {
      if (u.searchParams.get('v')) return u.searchParams.get('v').slice(0, 11);
      const m = u.pathname.match(/\/(embed|shorts|live)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[2];
    }
  } catch { /* not a URL */ }
  return null;
}

export function parseISODuration(d) {
  const m = String(d || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
}

export function createYouTube(config, fetchImpl = globalThis.fetch) {
  const key = config.youtubeApiKey;
  const configured = !!key;
  async function call(endpoint, params) {
    if (!configured) throw new ServiceUnavailable('youtube', 'YouTube discovery needs YOUTUBE_API_KEY in .env.');
    const qs = new URLSearchParams({ ...params, key });
    let r;
    try { r = await fetchImpl(`https://www.googleapis.com/youtube/v3/${endpoint}?${qs}`, { signal: AbortSignal.timeout(20000) }); }
    catch (e) { throw new ServiceUnavailable('youtube', `YouTube unreachable: ${e.message}`, 'network_error'); }
    if (!r.ok) throw new ServiceUnavailable('youtube', `YouTube API error ${r.status}`, r.status === 403 ? 'quota_or_key' : 'upstream_error');
    return r.json();
  }
  async function search(query, maxResults = 10) {
    const data = await call('search', { part: 'snippet', q: query, type: 'video', maxResults: String(maxResults), relevanceLanguage: 'ta', videoEmbeddable: 'true', safeSearch: 'strict' });
    return (data.items || []).map((it) => it.id?.videoId).filter(Boolean);
  }
  async function details(ids) {
    if (!ids.length) return [];
    const data = await call('videos', { part: 'snippet,contentDetails,status', id: ids.join(',') });
    return (data.items || []).filter((v) => v.status?.embeddable !== false).map((v) => ({
      externalId: v.id,
      title: v.snippet?.title || '',
      channel: v.snippet?.channelTitle || '',
      description: (v.snippet?.description || '').slice(0, 2000),
      thumbnailUrl: v.snippet?.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
      publishedAt: v.snippet?.publishedAt || null,
      durationSeconds: parseISODuration(v.contentDetails?.duration),
      language: v.snippet?.defaultAudioLanguage || v.snippet?.defaultLanguage || '',
    }));
  }
  async function oembed(id) {
    // Public oEmbed endpoint: metadata for a single video without an API key.
    try {
      const r = await fetchImpl(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null;
      const d = await r.json();
      return { title: d.title, channel: d.author_name, thumbnailUrl: d.thumbnail_url };
    } catch { return null; }
  }
  return { configured, search, details, oembed };
}
