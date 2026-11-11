// Layered dictionary lookup shared by the Dictionary and the Reader — all free and local:
//   1 local library → 2 morphology (lemma of inflected forms) → 3 offline lexicon (Wiktionary/Kaikki + Wikidata Lexemes)
//   → 4 IndicTrans2 machine translation (local) → 5 Ollama enrichment (local) → 6 persistent cache in this database.
// Results from external sources are stored as library entries (status 'pending', origin = provider) so they
// can be saved, studied and enriched, but they never enter curated lists until an editor publishes them.
import { normalizeText, romanKey } from '../../shared/tamil.js';
import { LANGUAGES, langOfText, transliterateAny, validateNative, isLang } from '../../shared/indic.js';
import { analyze, composeGloss, describe } from '../../shared/morphology.js';
import { bad, notFound, parseJSON, j } from '../util.js';
import { normKey, PARTS_OF_SPEECH, strip } from './vocabulary.js';

const CACHE_DAYS = 30;
const POS_MAP = { noun: 'noun', verb: 'verb', adjective: 'adjective', adverb: 'adverb', pronoun: 'pronoun', postposition: 'postposition', preposition: 'postposition', conjunction: 'conjunction', interjection: 'interjection', particle: 'particle', phrase: 'idiom', proverb: 'idiom', idiom: 'idiom' };
const guessPos = (english) => (/\s/.test(english.trim()) ? 'idiom' : /ly$/.test(english) ? 'adverb' : 'noun');
const firstGloss = (def) => String(def || '').split(/[;(]/)[0].replace(/^(to |a |an |the )/i, (m) => (m.toLowerCase() === 'to ' ? 'to ' : '')).trim().slice(0, 80);

export function createLookupService({ db, clock, meta, vocabulary, dictionary, ai, providers, content }) {
  const now = () => clock.now().toISOString();
  function cacheGet(lang, direction, qn, provider) {
    const r = db.get('SELECT * FROM dictionary_cache WHERE lang = ? AND direction = ? AND query_norm = ? AND provider = ? AND expires_at > ?', lang, direction, qn, provider, now());
    return r ? { status: r.status, payload: parseJSON(r.payload, {}) } : null;
  }
  function cacheSet(lang, direction, qn, provider, status, payload, days = CACHE_DAYS) {
    const exp = new Date(clock.now().getTime() + days * 86400_000).toISOString();
    db.run(`INSERT INTO dictionary_cache(lang, direction, query_norm, provider, status, payload, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(lang, direction, query_norm, provider) DO UPDATE SET status = excluded.status, payload = excluded.payload, created_at = excluded.created_at, expires_at = excluded.expires_at`, lang, direction, qn, provider, status, j(payload), now(), exp);
  }
  const findEntry = (lang, native) => db.get("SELECT id FROM vocabulary WHERE lang = ? AND tamil = ? AND status != 'rejected' ORDER BY CASE status WHEN 'published' THEN 0 ELSE 1 END, id LIMIT 1", lang, native)?.id;

  /** Store an external/AI result as a (pending) library entry; reuse an existing identical entry. */
  function materialize(lang, { native, english, pos, definition = '', register = 'common', level = 'B1', origin, alt = [], hindi = '' }) {
    const n = String(native || '').normalize('NFC').trim();
    const e = String(english || '').trim();
    if (!n || !e || validateNative(n, lang).length) return null;
    const key = normKey(n, e, lang);
    const ex = db.get('SELECT id FROM vocabulary WHERE norm_key = ?', key);
    if (ex) return ex.id;
    const p = PARTS_OF_SPEECH.includes(POS_MAP[pos] || pos) ? (POS_MAP[pos] || pos) : guessPos(e);
    const id = vocabulary.create({ tamil: n, english: e.slice(0, 200), alt_english: alt, part_of_speech: p, level, register: ['common', 'spoken', 'formal', 'literary', 'colloquial'].includes(register) ? register : 'common', definition, hindi },
      { lang, status: 'pending', source: origin === 'ai' ? 'ai' : 'import', reviewStatus: 'ai-unreviewed', extraValidation: { origin, posGuessed: !pos } });
    db.run('UPDATE vocabulary SET origin = ? WHERE id = ?', origin, id);
    return id;
  }
  const entryView = (id, extra = {}) => { const v = vocabulary.get(id, { any: true }); return v ? { ...strip(v), translation: v.english, ...extra } : null; };

  // ------------------------------------------------------------ external (local service) lookups
  const ORIGIN = (basis = '') => (/indic-glossaries/i.test(basis) ? 'indic-glossaries' : /datuk/i.test(basis) ? 'datuk' : /wikidata/i.test(basis) ? 'wikidata' : /alar/i.test(basis) ? 'alar' : /olam/i.test(basis) ? 'olam' : /open-tamil/i.test(basis) ? 'open-tamil' : /ollama/i.test(basis) ? 'local-llm' : /wiktionary|kaikki/i.test(basis) ? 'wiktionary' : /indictrans/i.test(basis) ? 'indictrans2' : 'local');
  const LEXICON_ATTR = 'Wiktionary via Kaikki.org (CC BY-SA 4.0) · Wikidata Lexemes (CC0)';
  const mark = (text, w) => (text.includes(w) ? text.replace(w, `[[${w}]]`) : text);
  const relWords = (s, ...kinds) => kinds.flatMap((k) => (s.relations?.[k] || []).map((r) => ({ native: r.word.replace(/\s*\([^)]*[A-Za-z][^)]*\)\s*$/u, '').trim(), english: '', nuance: r.note || '', context: '' })));

  /** Persist Wiktionary/Wikidata senses, examples and relations of a lexicon entry onto a library entry (shown publicly). */
  function storeSourceMetadata(id, entries, provenance) {
    for (const e of entries || []) {
      for (const [i, sense] of (e.senses || []).entries()) if (sense.native_definition) db.run(
        'INSERT OR IGNORE INTO dictionary_native_definitions(vocabulary_id,lang,definition,grammar,source,source_record_id,source_url) VALUES(?,?,?,?,?,?,?)',
        id,e.lang,String(sense.native_definition).slice(0,3000),String(sense.grammar || ''),e.source,String(sense.source_record_id || i),e.source_url || '');
      if(e.provenance) db.run('INSERT OR IGNORE INTO dictionary_provenance(vocabulary_id,source,record_key,payload) VALUES(?,?,?,?)',id,e.source,j(e.provenance),j(e.provenance));
    }
    if(provenance)db.run('INSERT OR IGNORE INTO dictionary_provenance(vocabulary_id,source,record_key,payload) VALUES(?,?,?,?)',id,'indic-glossaries',j(provenance),j(provenance));
  }
  function storeLexicon(id, lexEntries, lemma) {
    storeSourceMetadata(id, lexEntries);
    const first = lexEntries.find(e => e.senses?.some(s => s.gloss)) || lexEntries[0];
    const senses = lexEntries.flatMap((e) => e.senses).filter(s => s.gloss).slice(0, 6).map((s, i) => ({
      gloss: firstGloss(s.gloss) || s.gloss, definition: s.gloss, part_of_speech: POS_MAP[first.pos] || '',
      synonyms: relWords(s, 'synonym').concat(i === 0 ? lexEntries.flatMap((e) => relWords(e, 'synonym')) : []).filter((x) => normalizeText(x.native) !== normalizeText(lemma)),
      antonyms: relWords(s, 'antonym').concat(i === 0 ? lexEntries.flatMap((e) => relWords(e, 'antonym')) : []),
      related: relWords(s, 'related').concat(i === 0 ? lexEntries.flatMap((e) => relWords(e, 'related', 'derived', 'coordinate')) : []),
      examples: (s.examples || []).filter((x) => x.text).map((x) => ({ native: mark(x.text, lemma), english: x.english || '', note: x.roman ? `Romanised: ${x.roman}` : '' })),
    }));
    return dictionary.storeEnrichment(id, { senses }, { source: first.source || 'wiktionary', reviewStatus: 'editor', validateFn: (t, l) => (l === 'hi' ? (/[\u0900-\u097F]/.test(t) ? [] : ['not Devanagari']) : validateNative(t, l)) });
  }

  async function fromEnglish(word, lang) {
    const qn = normalizeText(word);
    const cached = cacheGet(lang, 'from_en', qn, 'expanded-v2');
    if (cached?.status === 'ok') return cached.payload.ids.map((id) => entryView(id, { match: { score: 85, type: 'external' } })).filter(Boolean);
    if (!providers.configured()) return [];
    const r = await providers.lookupEnglish(word, lang, { disambiguate: true });
    const ids = [];
    for (const c of (r.candidates || []).slice(0, 12)) {
      const origin = ORIGIN(c.basis);
      const english = c.sense && origin !== 'indictrans2' && !/^\s*$/.test(c.sense) && c.basis.includes('definition') ? firstGloss(c.sense) : word;
      const id = materialize(lang, { native: c.native, english, pos: c.pos, definition: c.sense && c.sense !== english ? c.sense : '', origin, level: 'B1' });
      if (id && !ids.includes(id)) ids.push(id);
      if (id && c.entries?.length) storeLexicon(id, c.entries, c.native);
      if (id && c.provenance) storeSourceMetadata(id, [], c.provenance);
    }
    if (!ids.length && r.machine_translation?.error) throw new Error(r.machine_translation.error);
    if (ids.length) cacheSet(lang, 'from_en', qn, 'expanded-v2', 'ok', { ids, sources: r.sources }, 3650);
    return ids.map((id) => entryView(id, { match: { score: 85, type: 'external' } })).filter(Boolean);
  }

  async function toEnglish(word, lang, { context } = {}) {
    const qn = j({word:normalizeText(word),context:normalizeText(context || '').slice(0,400)});
    const cached = cacheGet(lang, 'to_en', qn, 'expanded-v2');
    if (cached?.status === 'ok' && vocabulary.get(cached.payload.id, { any: true })) return cached.payload;
    if (!providers.configured()) return null;
    const lemmas = analyze(word, lang).map((a) => a.lemma);
    const r = await providers.lookupNative(word, lang, { candidates: lemmas, context });
    let result = null;
    if (r.entries?.length) {
      const e = r.entries.find(e=>e.senses?.some(s=>s.gloss)) || r.entries[0];
      const gloss = e.senses.find(s=>s.gloss)?.gloss || r.machine_translation?.candidates?.[0] || '[English translation unavailable]';
      const id = materialize(lang, { native: e.word, english: firstGloss(gloss) || gloss || word, pos: e.pos, definition: e.senses.map((s) => s.gloss).filter(Boolean).join('; ').slice(0, 900), origin: e.source || 'wiktionary',
        alt: e.senses.slice(1).map((s) => firstGloss(s.gloss)).filter(Boolean).slice(0, 5) });
      if (id) { storeLexicon(id, r.entries, e.word); result = { id, lemma: e.word, provider: e.source || 'wiktionary', attribution: LEXICON_ATTR, via: r.via, formMeaning: r.context_translation?.candidates?.[0] ? `In context: “${r.context_translation.candidates[0]}”` : undefined }; }
    } else if (r.machine_translation?.candidates?.length) {
      const [best, ...rest] = r.machine_translation.candidates;
      const origin = /ollama/i.test(r.machine_translation.engine || '') ? 'local-llm' : 'indictrans2';
      const id = materialize(lang, { native: word, english: best, origin, alt: rest });
      if (id) result = { id, lemma: word, provider: origin, attribution: r.machine_translation.engine, formMeaning: r.context_translation?.candidates?.[0] ? `In context: “${r.context_translation.candidates[0]}”` : undefined };
    } else if (r.machine_translation?.error) {
      throw new Error(r.machine_translation.error);
    }
    if (result && !glossUnavailable(result.id)) cacheSet(lang, 'to_en', qn, 'expanded-v2', 'ok', result, 3650);
    return result;
  }
  const glossUnavailable = (id) => vocabulary.get(id,{any:true})?.english === '[English translation unavailable]';
  const externalConfigured = () => providers.configured();

  /** Local lemma for an inflected form (word_forms cache → analyser candidates that exist in the library). */
  function resolveForm(token, lang) {
    const t = String(token || '').normalize('NFC').trim();
    const cached = db.get('SELECT * FROM word_forms WHERE lang = ? AND form = ? ORDER BY id LIMIT 1', lang, t);
    if (cached?.lemma_vocabulary_id) {
      const v = vocabulary.get(cached.lemma_vocabulary_id, { any: true });
      if (v) { const a = parseJSON(cached.analysis, {}); return { entry: strip(v), analysis: { form: t, lemma: v.tamil, ...a, gloss: composeGloss(a.grammar, v.english) } }; }
    }
    for (const cand of analyze(t, lang)) {
      const id = findEntry(lang, cand.lemma);
      if (!id) continue;
      const v = vocabulary.get(id, { any: true });
      const analysis = { suffix: cand.suffix, grammar: cand.grammar, description: describe(cand.grammar) };
      db.run('INSERT OR IGNORE INTO word_forms(lang, form, lemma, lemma_vocabulary_id, analysis, gloss, source, created_at) VALUES (?,?,?,?,?,?,?,?)', lang, t, v.tamil, id, j(analysis), composeGloss(cand.grammar, v.english), 'analyser', now());
      return { entry: strip(v), analysis: { form: t, lemma: v.tamil, ...analysis, gloss: composeGloss(cand.grammar, v.english) } };
    }
    return null;
  }

  // ------------------------------------------------------------ public API
  async function search(q, { lang = 'ta', direction = 'auto', admin = false, context = '' } = {}) {
    if (!isLang(lang)) throw bad('Unknown language');
    const local = dictionary.search(q, { lang, direction });
    const raw = local.query;
    if (!raw) return { ...local, status: 'empty' };
    const script = langOfText(raw);
    let results = local.results;
    let analysis = null;
    let status = 'ok';
    let sourceError = null;
    const strong = results.some((r) => r.match.score >= 80);
    if (!strong && script === lang) {
      const m = resolveForm(raw, lang);
      if (m) { analysis = m.analysis; results = [{ ...m.entry, translation: m.entry.english, match: { score: 90, type: 'inflected form' }, analysis }, ...results.filter((r) => r.id !== m.entry.id)]; }
    }
    // English queries also consult the offline lexicon when the library has fewer than three matches,
    // so other senses (e.g. "love" = அன்பு affection as well as காதல் romance) are shown, not just the first hit.
    const fewEnglish = !script && direction !== 'to_en';
    if ((!strong || fewEnglish) && !analysis && (!script || script === lang)) {
      const wantFromEn = !script && direction !== 'to_en';
      if (externalConfigured()) {
        try {
          if (wantFromEn) { const ext = await fromEnglish(raw, lang); results = [...results, ...ext.filter((e) => !results.some((r) => r.id === e.id))]; }
          else if (script === lang || direction === 'to_en') { const r = await toEnglish(raw, lang, { context }); if (r) { const v = entryView(r.id, { match: { score: 85, type: r.lemma !== raw ? 'inflected form' : 'external' }, source: r.provider, attribution: r.attribution }); if (v) results.unshift(v); } }
        } catch (e) { status = results.length ? 'ok' : 'unavailable'; sourceError = e.message; }
      }
      if (!results.length && status === 'ok') status = externalConfigured() ? 'not_found' : 'not_found_offline';
    }
    const selected=results.find(r=>r.match.score>=80);
    if (!analysis && script===lang && selected && normalizeText(selected.native)!==normalizeText(raw)) {
      const a=analyze(raw,lang).find(a=>normalizeText(a.lemma)===normalizeText(selected.native));
      if(a)analysis={form:raw,lemma:selected.native,grammar:a.grammar,description:describe(a.grammar),gloss:composeGloss(a.grammar,selected.english),basis:'rule-based analysis checked against dictionary lemma'};
    }
    if(results.some(r=>r.english==='[English translation unavailable]'))status='partial';
    const out = { query: raw, lang: local.lang, dictionary: lang, direction, results, analysis, status, sourceError };
    if (admin) out.diagnostics = { providers: providers.status(), ai: ai.configured, localMatches: local.results.length };
    return out;
  }

  /** Reader / transcript word lookup with morphology and context. */
  async function lookupToken(token, lang, { context } = {}) {
    const clean=String(token||'').normalize('NFC').replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu,'');
    const result=await search(clean,{lang,direction:'to_en',context});
    const entry=result.results.find(r=>r.match.score>=80)||null;
    return {token:clean,entry,analysis:result.analysis,match:result.analysis?'inflected':entry?'exact':null,status:result.status,sourceError:result.sourceError};
  }
  async function suggest(q,opts={}) {
    const local=dictionary.suggest(q,opts);if(!providers.suggest || !providers.configured())return local;
    try {const extra=await providers.suggest(String(q||'').slice(0,100),opts.lang||'ta');
      return [...local,...(extra.items||[]).filter(x=>!local.some(l=>l.native===x.native)).map(x=>({native:x.native,tamil:x.native,transliteration:x.roman||transliterateAny(x.native),label:x.english,source:x.source}))].slice(0,8);
    }catch{return local;}
  }

  /** Fill an entry's equivalents (Wikidata sense links, English pivot, IndicTrans2) and lexical sections
   *  (Wiktionary relations/examples, Ollama enrichment). Every result is stored permanently. */
  const completing = new Map();
  async function completeEntry(id) {
    id = Number(id);
    if (completing.has(id)) return completing.get(id);
    const task = doComplete(id).finally(() => completing.delete(id));
    completing.set(id, task);
    return task;
  }
  async function doComplete(id) {
    const v = vocabulary.get(id, { any: true });
    if (!v) throw notFound('Entry not found');
    const report = { equivalents: 0, lexicon: 0, enrichment: null, errors: [], similarWords: [] };
    const sense = db.get('SELECT id FROM word_senses WHERE vocabulary_id = ? AND sense_no = 1', v.id);
    if (!sense || !providers.configured()) return { report, entry: dictionary.entry(v.id) };
    const ok = (t, l) => (l === 'hi' ? (/[\u0900-\u097F]/.test(t) ? [] : ['not Devanagari']) : validateNative(t, l));
    if (!cacheGet(v.lang, 'equiv', String(v.id), 'local')) {
      const have = new Set(dictionary.entry(v.id).senses[0].equivalents.map((e) => e.lang));
      const targets = ['ta', 'ml', 'kn', 'te', 'hi'].filter((x) => x !== v.lang && !have.has(x));
      try {
        if (targets.length) {
          const r = await providers.equivalents({ word: v.tamil, lang: v.lang, gloss: v.english, targets });
          for (const [l, items] of Object.entries(r.equivalents || {})) for (const it of items.slice(0, 2)) {
            if (!targets.includes(l) || !it.native || ok(it.native, l).length) continue;
            const machine = /IndicTrans2|Ollama/i.test(it.basis || '');
            report.equivalents += db.run('INSERT OR IGNORE INTO sense_equivalents(sense_id, lang, native, transliteration, english_note, source, review_status) VALUES (?,?,?,?,?,?,?)',
              sense.id, l, it.native, transliterateAny(it.native), it.english || v.english, ORIGIN(it.basis), machine ? 'ai-unreviewed' : 'imported').changes;
          }
        }
        const missing = targets.filter((l) => l !== 'hi' && !dictionary.entry(v.id).senses[0].equivalents.some((e) => e.lang === l));
        if (!missing.length) cacheSet(v.lang, 'equiv', String(v.id), 'local', 'ok', { n: report.equivalents }, 30);
      } catch (e) { report.errors.push('Cross-language lookup: ' + e.message); }
    }
    const cached = cacheGet(v.lang, 'enrich-v5-sentences', String(v.id), 'local');
    if (cached) report.similarWords = cached.payload.similarWords || [];
    else {
      try {
        const r = await providers.enrich({ word: v.tamil, lang: v.lang, gloss: v.english, pos: v.partOfSpeech });
        if (r.lexicon?.length) report.lexicon = storeLexicon(v.id, r.lexicon, v.tamil).stored;
        report.similarWords = (r.similar_words || []).filter((x) => x.native && !ok(x.native, v.lang).length);
        if (r.web_examples?.length) dictionary.storeEnrichment(v.id, { senses: [{ gloss: v.english,
          examples: r.web_examples.map((x) => ({ native: mark(x.native, v.tamil), english: x.english || '', note: x.note || '' }))
        }] }, { source: 'wikipedia', reviewStatus: 'editor', validateFn: ok });
        if (r.web_error) report.errors.push('Online examples could not be checked. Offline sources and AI are still available.');
        if (r.llm) {
          const L = r.llm;
          report.enrichment = dictionary.storeEnrichment(v.id, { senses: [{ gloss: v.english, synonyms: L.synonyms, near_synonyms: L.near_synonyms, contextual_alternatives: L.contextual_alternatives, related: L.related,
            antonyms: L.antonyms, contextual_opposites: L.contextual_opposites, contrasts: L.contrasts, collocations: L.collocations,
            examples: (L.examples || []).map((x) => ({ native: x.native, english: x.english, register: x.register, note: x.note })) }] }, { source: 'local-llm', reviewStatus: 'ai-unreviewed', validateFn: ok }).stored;
          // Cache actual usable content only. Failures remain retryable after fixing setup.
          if (report.enrichment > 0 && dictionary.entry(v.id).senses[0].examples.length >= 3) cacheSet(v.lang, 'enrich-v5-sentences', String(v.id), 'local', 'ok', { similarWords: report.similarWords }, 30);
        } else if (r.llm_error) report.errors.push('AI enrichment: ' + r.llm_error);
      } catch (e) { report.errors.push('Enrichment: ' + e.message); }
    }
    return { report, entry: dictionary.entry(v.id) };
  }

  return { search, suggest, lookupToken, completeEntry, resolveForm, configured: externalConfigured, materialize };
}
