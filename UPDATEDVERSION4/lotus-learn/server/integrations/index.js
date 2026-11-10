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

// ------------------------------------------------------------------ AI (local only)
// LotusLearn uses NO paid or cloud AI. All generation runs on this computer through Ollama
// (https://ollama.com) with an open-weight model chosen by local-dictionary/setup_local_dictionary.py.
export function createAI(config, fetchImpl = globalThis.fetch) {
  const a = config.ai;
  const url = String(a.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model = a.ollamaModel || '';
  const configured = a.provider === 'ollama' && !!model;

  async function complete({ system, prompt, maxTokens = 2000, temperature = 0.4, json = false }) {
    if (!configured) throw new ServiceUnavailable('ai', 'No local model configured. Install Ollama and set OLLAMA_MODEL (see local-dictionary/README.md).');
    let res;
    try {
      res = await fetchImpl(`${url}/api/generate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, system, prompt, stream: false, ...(json ? { format: 'json' } : {}), options: { temperature, num_predict: maxTokens, num_ctx: 8192 } }),
        signal: AbortSignal.timeout(a.timeoutMs),
      });
    } catch (e) {
      throw new ServiceUnavailable('ai', `Local model (Ollama) unreachable at ${url}: ${e.message}`, 'network_error');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ServiceUnavailable('ai', `Ollama error ${res.status}: ${body.slice(0, 300)}`, 'upstream_error');
    }
    const data = await res.json();
    if (!data.response) throw new ServiceUnavailable('ai', 'Local model returned an empty response', 'empty_response');
    return data.response;
  }

  async function completeJSON(opts) {
    const text = await complete({ ...opts, json: true, system: `${opts.system}\nRespond with JSON only.` });
    const cleaned = text.replace(/```(?:json)?/g, '').trim();
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (start < 0 || end < start) throw new ServiceUnavailable('ai', 'Local model response did not contain JSON', 'bad_output');
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { throw new ServiceUnavailable('ai', 'Local model JSON could not be parsed', 'bad_output'); }
  }

  return { configured, provider: configured ? 'ollama' : 'none', model: configured ? model : null, complete, completeJSON };
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
  // The YouTube Data API is a Google Cloud API, which LotusLearn no longer uses (zero paid / cloud APIs).
  // Automatic discovery is therefore off; administrators add videos by link. oEmbed (public, keyless) still fills titles.
  const key = '';
  const configured = false;
  async function call(endpoint, params) {
    if (!configured) throw new ServiceUnavailable('youtube', 'YouTube discovery needs YOUTUBE_API_KEY in .env.');
    const qs = new URLSearchParams({ ...params, key });
    let r;
    try { r = null; throw new Error('YouTube Data API removed (Google Cloud)'); }
    catch (e) { throw new ServiceUnavailable('youtube', `YouTube unreachable: ${e.message}`, 'network_error'); }
    if (!r.ok) throw new ServiceUnavailable('youtube', `YouTube API error ${r.status}`, r.status === 403 ? 'quota_or_key' : 'upstream_error');
    return r.json();
  }
  async function search(query, maxResults = 10, lang = 'ta') {
    const data = await call('search', { part: 'snippet', q: query, type: 'video', maxResults: String(maxResults), relevanceLanguage: lang, videoEmbeddable: 'true', safeSearch: 'strict' });
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
