// Free, local dictionary providers. ZERO paid APIs.
// Everything goes to the LotusLearn local dictionary service (local-dictionary/, Python), which runs:
//   • AI4Bharat IndicTrans2 (MIT) for en ↔ ta/ml/kn/te/hi and Indic ↔ Indic translation (or an English pivot)
//   • Kaikki.org Wiktionary extracts (CC BY-SA 4.0) and Wikidata Lexemes (CC0), indexed offline in SQLite
//   • Ollama with a local open-weight model for sense grouping and enrichment
// The Node backend caches every successful result in its own database.
import { ServiceUnavailable } from './index.js';

export function createDictionaryProviders(env = process.env, fetchImpl = globalThis.fetch) {
  const url = String(env.LOCAL_DICT_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
  const enabled = !/^(0|false|no|off)$/i.test(env.LOCAL_DICT_ENABLED || 'true');
  const timeoutMs = Number(env.LOCAL_DICT_TIMEOUT_MS || 120000);
  let health = null; let checkedAt = 0; let calls = 0;

  async function call(path, body, ms = timeoutMs) {
    if (!enabled) throw new ServiceUnavailable('local-dictionary', 'The local dictionary service is disabled (LOCAL_DICT_ENABLED=false).', 'not_configured');
    calls++;
    let r;
    try {
      r = await fetchImpl(url + path, body === undefined ? { signal: AbortSignal.timeout(ms) } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    } catch (e) {
      health = { ok: false, error: e.message }; checkedAt = Date.now();
      throw new ServiceUnavailable('local-dictionary', `Local dictionary service not reachable at ${url}: ${e.message}`, 'network_error');
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new ServiceUnavailable('local-dictionary', data.error || `Local dictionary service error ${r.status}`, 'upstream_error');
    return data;
  }
  async function refresh(force = false) {
    if (!enabled) return { ok: false, disabled: true };
    if (!force && health && Date.now() - checkedAt < 20000) return health;
    try { health = await call('/health', undefined, 3000); } catch (e) { health = { ok: false, error: e.message }; }
    checkedAt = Date.now();
    return health;
  }
  const label = 'Local dictionary (IndicTrans2 · Wiktionary/Kaikki · Wikidata Lexemes · Ollama)';
  return {
    name: 'local', url, enabled,
    get calls() { return calls; },
    translators: [{ name: 'indictrans2', label: 'AI4Bharat IndicTrans2 (local)', configured: enabled }],
    definers: [{ name: 'lexicon', label: 'Wiktionary (Kaikki) + Wikidata Lexemes (local index)', configured: enabled }],
    configured: () => enabled,
    anyTranslator: () => enabled,
    health: refresh,
    status: () => [{ name: 'local-dictionary', label, configured: enabled, url, health, paidApis: false }],
    /** English → native candidates (translation tables, gloss index, IndicTrans2 n-best; optional local-LLM sense grouping) */
    lookupEnglish: (word, lang, { disambiguate = true } = {}) => call('/lookup', { text: word, lang, direction: 'from_en', disambiguate }),
    /** Native word or inflected form → lexicon entries; machine translation when the lexicon has nothing */
    lookupNative: (word, lang, { candidates = [], context = '', alwaysTranslate = false } = {}) => call('/lookup', { text: word, lang, direction: 'to_en', candidates, context, always_translate: alwaysTranslate }),
    translate: async ({ text, from, to, n = 1 }) => { const r = await call('/translate', { text, src: from, tgt: to, n }); return r.candidates?.length ? { text: r.candidates[0], candidates: r.candidates, path: r.path, provider: 'indictrans2' } : null; },
    equivalents: ({ word, lang, gloss, targets }) => call('/equivalents', { word, lang, gloss, targets }),
    enrich: ({ word, lang, gloss, pos }) => call('/enrich', { word, lang, gloss, pos, web: true }, Math.max(timeoutMs, 300000)),
  };
}
