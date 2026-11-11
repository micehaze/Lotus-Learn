// Sense-aware multilingual dictionary: search (both directions, cross-script),
// full entries with senses, relations, structured collocations, examples,
// cross-language equivalents and homonyms. Honest about missing data.
import { normalizeText, romanKey, levenshtein } from '../../shared/tamil.js';
import { LANGUAGES, LANG_CODES, langOfText, transliterateAny, isLang } from '../../shared/indic.js';
import { bad, notFound } from '../util.js';
import { strip } from './vocabulary.js';

const REL_GROUPS = { synonym: 'synonyms', near_synonym: 'nearSynonyms', contextual_alternative: 'contextualAlternatives', related: 'related', antonym: 'antonyms', contextual_opposite: 'contextualOpposites', contrast: 'contrasts' };
/** An example must be a real sentence: several words in the target script, not a bare word or a link label. */
export const isSentence = (t) => { const s = String(t || '').replace(/\[\[|\]\]/g, '').trim(); return s.split(/\s+/).filter(Boolean).length >= 2 && /[\u0B80-\u0D7F]/.test(s); };
const COL_GROUPS = ['adj_noun', 'noun_verb', 'adv_verb', 'common'];
export const TARGET_RANGE = { synonyms: [10, 15], antonyms: [10, 15], collocations: [10, 15], examples: [5, 7] };

export function createDictionaryService({ db, vocabulary, meta }) {
  function scoreEntry(v, qn, qk, mode) {
    let best = 0; let how = '';
    const consider = (s, label) => { if (s > best) { best = s; how = label; } };
    const fieldMatch = (values, label, base = 100) => {
      for (const val of values) {
        if (!val) continue;
        if (val === qn) consider(base, `exact ${label}`);
        else if (val.startsWith(qn) && qn.length >= 2) consider(base - 18, `partial ${label}`);
        else if (qn.length >= 3 && new RegExp(`(^|[\\s(/-])${qn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(val)) consider(base - 30, `partial ${label}`);
        else if (qn.length >= 4) {
          const d = levenshtein(val, qn, 2);
          if (d === 1) consider(base - 45, `fuzzy ${label}`);
          else if (d === 2 && qn.length >= 7) consider(base - 55, `fuzzy ${label}`);
        }
      }
    };
    if (mode.kind === 'native') {
      fieldMatch([v._ta], 'native word');
      if (v._forms.some((f) => normalizeText(f) === qn)) consider(92, 'verb form');
      if (v.synonyms.some((s) => normalizeText(s) === qn)) consider(70, 'synonym');
      if (qn.length >= 3 && v.collocations.some((c) => normalizeText(c.ta.replace(/\[\[|\]\]/g, '')).includes(qn))) consider(40, 'phrase');
    } else if (mode.kind === 'hi') fieldMatch(v._hi, 'Hindi');
    else if (mode.kind === 'ml-field') fieldMatch(v._ml, 'Malayalam');
    else { // Latin input: English meaning and/or romanised native word
      if (mode.direction !== 'to_en') fieldMatch(v._en, 'English');
      if (mode.direction !== 'from_en' && qk.length >= 2) {
        if (v._rk === qk || (v._rk2 && v._rk2 === qk)) consider(96, 'transliteration');
        else if (qk.length >= 4 && v._rk.startsWith(qk) && qk.length >= v._rk.length * 0.6) consider(60, 'partial transliteration');
        else if (qk.length >= 4 && levenshtein(v._rk, qk, 1) <= 1) consider(55, 'fuzzy transliteration');
      }
      if (mode.direction !== 'to_en' && (qn.includes(' ') || qn.length >= 4)) {
        if (v.collocations.some((c) => normalizeText(c.en).includes(qn))) consider(42, 'phrase');
        else if (v.examples.some((c) => normalizeText(c.en).split(/\W+/).includes(qn))) consider(30, 'example');
      }
    }
    return { score: best, how };
  }

  function rank(list, qn, qk, mode) {
    const out = [];
    for (const v of list) { const r = scoreEntry(v, qn, qk, mode); if (r.score > 0) out.push({ v, ...r }); }
    return out.sort((a, b) => b.score - a.score || a.v.tamil.localeCompare(b.v.tamil));
  }

  /**
   * Search one language's dictionary.
   * direction: 'to_en' (native/romanised → English), 'from_en' (English → native) or 'auto'.
   * Queries typed in another supported script (or Hindi) are matched in that language and
   * mapped to the active language through shared-meaning links (concept keys).
   */
  function search(q, { lang = 'ta', direction = 'auto', limit = 20 } = {}) {
    if (!isLang(lang)) throw bad('Unknown language');
    const raw = String(q || '').trim().slice(0, 100);
    if (!raw) return { query: raw, lang: 'en', dictionary: lang, direction, results: [] };
    const script = langOfText(raw);
    const qn = normalizeText(raw);
    const qk = romanKey(raw);
    let ranked = [];
    let inputLang = script || 'en';
    if (script === lang) ranked = rank((vocabulary.forDictionary || vocabulary.published)(lang), qn, qk, { kind: 'native' });
    else if (script === 'hi') ranked = rank((vocabulary.forDictionary || vocabulary.published)(lang), qn, qk, { kind: 'hi' });
    else if (script && isLang(script)) {
      // cross-script: find in the other language, map by concept; fall back to legacy translation fields
      const other = rank((vocabulary.forDictionary || vocabulary.published)(script), qn, qk, { kind: 'native' }).filter((r) => r.score >= 80);
      const byConcept = new Map((vocabulary.forDictionary || vocabulary.published)(lang).filter((v) => v.conceptKey).map((v) => [v.conceptKey, v]));
      for (const o of other) { const t = o.v.conceptKey && byConcept.get(o.v.conceptKey); if (t) ranked.push({ v: t, score: o.score, how: `${LANGUAGES[script].name} equivalent` }); }
      if (script === 'ml') for (const r of rank((vocabulary.forDictionary || vocabulary.published)(lang), qn, qk, { kind: 'ml-field' })) if (!ranked.some((x) => x.v.id === r.v.id)) ranked.push(r);
      ranked.sort((a, b) => b.score - a.score);
    } else ranked = rank((vocabulary.forDictionary || vocabulary.published)(lang), qn, qk, { kind: 'latin', direction });
    if (!script) inputLang = direction === 'to_en' ? 'romanised' : 'en';
    const results = ranked.slice(0, limit).map(({ v, score, how }) => ({
      ...strip(v), match: { score, type: how },
      translation: inputLang === 'hi' ? v.hindi : inputLang === 'ml' && lang !== 'ml' ? (v.malayalam || v.english) : v.english,
      verified: v.reviewStatus === 'native-reviewed' ? 'native-reviewed' : 'library',
    }));
    return { query: raw, lang: inputLang, dictionary: lang, direction, results };
  }

  function suggest(q, opts) {
    return search(q, { ...opts, limit: 8 }).results.map((r) => ({ id: r.id, tamil: r.tamil, native: r.native, transliteration: r.transliteration, label: r.translation || r.english }));
  }

  /** Reader lookup: exact form, verb form, or the longest dictionary stem of an inflected token. */
  function lookup(token, lang = 'ta') {
    const L = LANGUAGES[lang] || LANGUAGES.ta;
    const t = normalizeText(token).replace(new RegExp(`[^\\u${L.start.toString(16).padStart(4, '0')}-\\u${L.end.toString(16).padStart(4, '0')}]`, 'gu'), '');
    if (!t) return { token, entry: null };
    const all = (vocabulary.forDictionary || vocabulary.published)(lang);
    const exact = all.find((v) => v._ta === t) || all.find((v) => v._forms.some((f) => normalizeText(f) === t));
    if (exact) return { token: t, entry: strip(exact), match: 'exact' };
    let best = null;
    for (const v of all) {
      const stems = [v._ta, v._ta.replace(/[\u0BC1\u0D4D\u0CC1\u0C41]$/u, '')]; // drop final -u / virama for oblique stems (வீடு→வீட்டில்)
      for (const s of stems) if (s.length >= 2 && t.startsWith(s) && (!best || s.length > best.len)) best = { v, len: s.length };
    }
    if (best && best.len >= Math.min(3, t.length - 1)) return { token: t, entry: strip(best.v), match: 'stem' };
    return { token: t, entry: null };
  }

  const reviewed = (r) => r.review_status !== 'ai-unreviewed';
  function relItem(r) { return { id: r.id, native: r.native, transliteration: r.transliteration || transliterateAny(r.native), english: r.english, nuance: r.nuance, difference: r.difference, context: r.context, targetId: r.target_vocabulary_id, reviewStatus: r.review_status, source: r.source }; }

  /** Full dictionary entry. Learners get content only; editorial status and gap diagnostics are admin-only. */
  function entry(id, { admin = false } = {}) {
    const v = vocabulary.get(Number(id), { any: true });
    if (!v || v.status === 'rejected') throw notFound('Entry not found');
    const showAI = meta ? meta.getSettings().show_ai_enrichment : true;
    const senses = db.all('SELECT * FROM word_senses WHERE vocabulary_id = ? ORDER BY sense_no', v.id);
    const linked = v.conceptKey ? db.all("SELECT id, lang, tamil, transliteration, english FROM vocabulary WHERE concept_key = ? AND id != ? AND status = 'published' ORDER BY lang", v.conceptKey, v.id) : [];
    const out = senses.map((s) => {
      const rel = db.all('SELECT * FROM sense_relations WHERE sense_id = ? ORDER BY CASE source WHEN \'editor\' THEN 0 ELSE 1 END, id', s.id);
      const col = db.all('SELECT * FROM sense_collocations WHERE sense_id = ? ORDER BY id', s.id);
      const ex = db.all('SELECT * FROM sense_examples WHERE sense_id = ? ORDER BY id', s.id);
      const eq = db.all('SELECT * FROM sense_equivalents WHERE sense_id = ? ORDER BY lang, id', s.id);
      const relations = Object.fromEntries(Object.values(REL_GROUPS).map((k) => [k, []]));
      const unreviewed = { relations: [], collocations: [], examples: [], equivalents: [] };
      for (const r of rel) {
        if (r.relation === 'synonym' && normalizeText(r.native) === normalizeText(v.tamil)) continue;
        (reviewed(r) || showAI ? relations[REL_GROUPS[r.relation]] : unreviewed.relations).push({ ...relItem(r), relation: r.relation, aiAssisted: !reviewed(r) });
      }
      const collocations = Object.fromEntries(COL_GROUPS.map((k) => [k, []]));
      for (const c of col) {
        const item = { id: c.id, native: c.native, transliteration: c.transliteration || transliterateAny(c.native), english: c.english, explanation: c.explanation, structure: c.structure_label, source: c.source, reviewStatus: c.review_status, category: c.category, aiAssisted: !reviewed(c) };
        (reviewed(c) || showAI ? collocations[c.category] : unreviewed.collocations).push(item);
      }
      const examples = [];
      const webContexts = [];
      for (const e of ex) {
        if (!isSentence(e.native)) continue; // never render a bare word or a link as an example sentence
        if (e.source === 'local-llm' && (!/[.!?।]$/.test(e.native.trim()) || e.native.split(/\s+/).length < 3 || !/[.!?]$/.test(e.english.trim()))) continue;
        const item = { kind: 'sentence', id: e.id, native: e.native, transliteration: e.transliteration, english: e.english, register: e.register, note: e.note, source: e.source, reviewStatus: e.review_status, aiAssisted: !reviewed(e) };
        (e.source === 'wikipedia' ? webContexts : reviewed(e) || showAI ? examples : unreviewed.examples).push(item);
      }
      // cross-language equivalents: explicit sense rows + library entries sharing this meaning (sense 1) + Hindi field
      const equivalents = [];
      const seen = new Set();
      const push = (x) => { const k = `${x.lang}|${normalizeText(x.native)}`; if (seen.has(k)) return; seen.add(k); equivalents.push(x); };
      for (const e of eq) { const item = { kind: 'equivalent', lang: e.lang, native: e.native, transliteration: e.transliteration || transliterateAny(e.native), english: e.english_note, vocabularyId: e.target_vocabulary_id, basis: e.source === 'editor' || e.source === 'legacy' ? 'sense link' : e.source, reviewStatus: e.review_status, aiAssisted: !reviewed(e) }; if (reviewed(e) || showAI) push(item); else unreviewed.equivalents.push(item); }
      if (s.sense_no === 1) {
        for (const l of linked) push({ kind: 'equivalent', lang: l.lang, native: l.tamil, transliteration: l.transliteration, english: l.english, vocabularyId: l.id, basis: 'shared meaning in library', reviewStatus: 'editor' });
        if (v.hindi) push({ kind: 'equivalent', lang: 'hi', native: v.hindi, transliteration: transliterateAny(v.hindi), english: v.english, basis: 'entry translation', reviewStatus: v.reviewStatus });
        if (v.malayalam && v.lang !== 'ml') push({ kind: 'equivalent', lang: 'ml', native: v.malayalam, transliteration: transliterateAny(v.malayalam), english: v.english, basis: 'entry translation', reviewStatus: v.reviewStatus });
      }
      const wanted = ['ta', 'ml', 'kn', 'te', 'hi'].filter((l) => l !== v.lang);
      const counts = {
        synonyms: relations.synonyms.length + relations.nearSynonyms.length + relations.contextualAlternatives.length + relations.related.length,
        antonyms: relations.antonyms.length + relations.contextualOpposites.length + relations.contrasts.length,
        collocations: Object.fromEntries(COL_GROUPS.map((k) => [k, collocations[k].length])),
        examples: examples.length,
      };
      const notes = [];
      if (counts.synonyms < TARGET_RANGE.synonyms[0]) notes.push(`${counts.synonyms} checked synonym/related word(s). Lists are not padded to reach 10–15; true synonyms, near-synonyms and merely related words are labelled separately.`);
      if (counts.antonyms < TARGET_RANGE.antonyms[0]) notes.push(counts.antonyms ? `${counts.antonyms} opposite(s) recorded; many words have few natural antonyms.` : 'No antonym is recorded. Not every word has a natural opposite.');
      if (counts.examples < TARGET_RANGE.examples[0]) notes.push(`${counts.examples} checked example sentence(s) so far.`);
      const missing = wanted.filter((l) => !equivalents.some((e) => e.lang === l));
      if (missing.length) notes.push(`No checked equivalent yet for: ${missing.map((l) => (l === 'hi' ? 'Hindi' : LANGUAGES[l].name)).join(', ')}.`);
      const view = {
        id: s.id, senseNo: s.sense_no, gloss: s.gloss, definition: s.definition, partOfSpeech: s.part_of_speech || v.partOfSpeech,
        register: s.register || v.register, grammarNotes: s.grammar_notes, usageNotes: s.usage_notes,
        relations, collocations, examples, webContexts, equivalents, counts, missingEquivalents: missing,
      };
      if (admin) Object.assign(view, { reviewStatus: s.review_status, diagnostics: notes, unreviewed });
      return view;
    });
    const homonyms = db.all('SELECT * FROM word_homonyms WHERE vocabulary_id = ? ORDER BY kind, id', v.id)
      .filter(reviewed).map((h) => ({ kind: h.kind, native: h.native, transliteration: h.transliteration || transliterateAny(h.native), meaning: h.meaning, example: h.example, exampleEn: h.example_en }));
    const nativeDefinitions = db.all('SELECT lang,definition,grammar,source,source_record_id AS sourceRecordId,source_url AS sourceUrl FROM dictionary_native_definitions WHERE vocabulary_id=? ORDER BY id', v.id);
    const provenance = db.all('SELECT source,payload FROM dictionary_provenance WHERE vocabulary_id=? ORDER BY id',v.id).map(r=>({source:r.source,...JSON.parse(r.payload)}));
    const pub = { ...v, nativeDefinitions, provenance, senses: out, homonyms, languages: LANG_CODES, origin: db.get('SELECT origin FROM vocabulary WHERE id = ?', v.id)?.origin || '' };
    if (!admin) { delete pub.reviewStatus; delete pub.validation; delete pub.status; delete pub.source; }
    return pub;
  }

  /** Store AI or editor enrichment for an entry. AI rows are kept as 'ai-unreviewed'. */
  function storeEnrichment(vocabId, data, { source = 'ai', reviewStatus = 'ai-unreviewed', validateFn }) {
    const v = vocabulary.get(vocabId, { any: true });
    if (!v) throw notFound('Entry not found');
    const now = new Date().toISOString();
    const report = { stored: 0, rejected: [] };
    const ok = (text, lang = v.lang) => { const p = validateFn(text, lang); if (p.length) { report.rejected.push({ text, problems: p }); return false; } return true; };
    db.tx(() => {
      (data.senses || []).slice(0, 6).forEach((s, i) => {
        if (!s?.gloss) return;
        let sense = db.get('SELECT * FROM word_senses WHERE vocabulary_id = ? AND sense_no = ?', vocabId, i + 1);
        if (!sense) {
          db.run('INSERT INTO word_senses(vocabulary_id, sense_no, gloss, definition, part_of_speech, register, grammar_notes, usage_notes, source, review_status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            vocabId, i + 1, String(s.gloss).slice(0, 200), String(s.definition || '').slice(0, 1000), String(s.part_of_speech || v.partOfSpeech), String(s.register || ''), String(s.grammar_notes || '').slice(0, 600), String(s.usage_notes || '').slice(0, 600), source, reviewStatus, now);
          sense = db.get('SELECT * FROM word_senses WHERE vocabulary_id = ? AND sense_no = ?', vocabId, i + 1);
          report.stored++;
        } else if (!sense.definition && s.definition) db.run('UPDATE word_senses SET definition = ?, grammar_notes = COALESCE(NULLIF(grammar_notes, \'\'), ?), usage_notes = COALESCE(NULLIF(usage_notes, \'\'), ?) WHERE id = ?', String(s.definition).slice(0, 1000), String(s.grammar_notes || ''), String(s.usage_notes || ''), sense.id);
        for (const [rel, list] of Object.entries({ synonym: s.synonyms, near_synonym: s.near_synonyms, contextual_alternative: s.contextual_alternatives, related: s.related, antonym: s.antonyms, contextual_opposite: s.contextual_opposites, contrast: s.contrasts })) {
          for (const r of (list || []).slice(0, 15)) if (r?.native && ok(r.native)) { report.stored += db.run('INSERT OR IGNORE INTO sense_relations(sense_id, relation, native, transliteration, english, nuance, difference, context, source, review_status) VALUES (?,?,?,?,?,?,?,?,?,?)', sense.id, rel, r.native.normalize('NFC'), transliterateAny(r.native), String(r.english || ''), String(r.nuance || ''), String(r.difference || ''), String(r.context || ''), source, reviewStatus).changes; }
        }
        for (const cat of COL_GROUPS) for (const c of (s.collocations?.[cat] || []).slice(0, 15)) if (c?.native && ok(c.native)) report.stored += db.run('INSERT OR IGNORE INTO sense_collocations(sense_id, category, native, transliteration, english, explanation, structure_label, source, review_status) VALUES (?,?,?,?,?,?,?,?,?)', sense.id, cat, c.native.normalize('NFC'), transliterateAny(c.native), String(c.english || ''), String(c.explanation || ''), String(c.structure || ''), source, reviewStatus).changes;
        for (const e of (s.examples || []).slice(0, 7)) if (e?.native && isSentence(e.native) && ok(e.native.replace(/\[\[|\]\]/g, ''))) report.stored += db.run('INSERT OR IGNORE INTO sense_examples(sense_id, native, transliteration, english, register, note, source, review_status) VALUES (?,?,?,?,?,?,?,?)', sense.id, e.native.normalize('NFC'), transliterateAny(e.native.replace(/\[\[|\]\]/g, '')), String(e.english || ''), String(e.register || ''), String(e.note || ''), source, reviewStatus).changes;
        for (const e of (s.equivalents || [])) if (e?.native && ['ta', 'ml', 'kn', 'te', 'hi'].includes(e.lang) && e.lang !== v.lang && ok(e.native, e.lang)) report.stored += db.run('INSERT OR IGNORE INTO sense_equivalents(sense_id, lang, native, transliteration, english_note, source, review_status) VALUES (?,?,?,?,?,?,?)', sense.id, e.lang, e.native.normalize('NFC'), transliterateAny(e.native), String(e.english || ''), source, reviewStatus).changes;
      });
      for (const hmn of (data.homonyms || []).slice(0, 10)) if (hmn?.native && hmn.meaning && ['homophone', 'homonym'].includes(hmn.kind) && ok(hmn.native)) report.stored += db.run('INSERT OR IGNORE INTO word_homonyms(vocabulary_id, kind, native, transliteration, meaning, example, example_en, source, review_status) VALUES (?,?,?,?,?,?,?,?,?)', vocabId, hmn.kind, hmn.native.normalize('NFC'), transliterateAny(hmn.native), String(hmn.meaning), String(hmn.example || ''), String(hmn.example_en || ''), source, reviewStatus).changes;
    });
    vocabulary.invalidate();
    return report;
  }

  /** Approve (or reject = delete) every unreviewed AI row of an entry. */
  function reviewEnrichment(vocabId, approve) {
    const sids = db.all('SELECT id FROM word_senses WHERE vocabulary_id = ?', vocabId).map((r) => r.id);
    let n = 0;
    db.tx(() => {
      for (const t of ['sense_relations', 'sense_collocations', 'sense_examples', 'sense_equivalents']) for (const sid of sids) n += approve ? db.run(`UPDATE ${t} SET review_status = 'editor' WHERE sense_id = ? AND review_status = 'ai-unreviewed'`, sid).changes : db.run(`DELETE FROM ${t} WHERE sense_id = ? AND review_status = 'ai-unreviewed'`, sid).changes;
      n += approve ? db.run("UPDATE word_senses SET review_status = 'editor' WHERE vocabulary_id = ? AND review_status = 'ai-unreviewed'", vocabId).changes : db.run("DELETE FROM word_senses WHERE vocabulary_id = ? AND review_status = 'ai-unreviewed' AND sense_no > 1", vocabId).changes;
      n += approve ? db.run("UPDATE word_homonyms SET review_status = 'editor' WHERE vocabulary_id = ? AND review_status = 'ai-unreviewed'", vocabId).changes : db.run("DELETE FROM word_homonyms WHERE vocabulary_id = ? AND review_status = 'ai-unreviewed'", vocabId).changes;
    });
    vocabulary.invalidate();
    return { changed: n };
  }

  function pendingEnrichments() {
    return db.all(`SELECT v.id, v.lang, v.tamil, v.english, COUNT(*) AS n FROM vocabulary v JOIN word_senses s ON s.vocabulary_id = v.id
      LEFT JOIN sense_relations r ON r.sense_id = s.id AND r.review_status = 'ai-unreviewed'
      LEFT JOIN sense_examples e ON e.sense_id = s.id AND e.review_status = 'ai-unreviewed'
      LEFT JOIN sense_collocations c ON c.sense_id = s.id AND c.review_status = 'ai-unreviewed'
      WHERE r.id IS NOT NULL OR e.id IS NOT NULL OR c.id IS NOT NULL GROUP BY v.id ORDER BY v.id DESC LIMIT 100`);
  }

  return { search, suggest, lookup, entry, storeEnrichment, reviewEnrichment, pendingEnrichments };
}
