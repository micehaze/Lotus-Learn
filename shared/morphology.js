import { normalizeText } from './tamil.js';
// Rule-based morphological analyser for Tamil, Malayalam, Kannada and Telugu.
// It proposes lemma candidates for inflected / conjugated forms; the lookup engine only
// accepts a candidate that exists in a dictionary source, so over-generation is harmless.
// Coverage: common case suffixes (incl. plural + case), sandhi doubling and frequent verb endings.

const C = (case_, en) => ({ case: case_, en });
const CASE = {
  loc: C('locative', 'in / at'), dat: C('dative', 'to / for'), acc: C('accusative', 'object marker'), gen: C('genitive', 'of'),
  abl: C('ablative', 'from'), ins: C('instrumental', 'by / with'), soc: C('sociative', 'with (together with)'), pl: C('plural', 'more than one'),
};
const V = (tense, person, en) => ({ tense, person, en });

// [suffix, [restore strings appended to the stem], grammar]
const RULES = {
  ta: [
    ['ங்களிலிருந்து', ['ம்'], [CASE.pl, CASE.abl]], ['ங்களில்', ['ம்'], [CASE.pl, CASE.loc]], ['ங்களுக்கு', ['ம்'], [CASE.pl, CASE.dat]], ['ங்களை', ['ம்'], [CASE.pl, CASE.acc]], ['ங்கள்', ['ம்'], [CASE.pl]],
    ['க்களில்', [''], [CASE.pl, CASE.loc]], ['களில்', [''], [CASE.pl, CASE.loc]], ['களுக்கு', [''], [CASE.pl, CASE.dat]], ['களை', [''], [CASE.pl, CASE.acc]], ['க்கள்', [''], [CASE.pl]], ['கள்', [''], [CASE.pl]],
    ['த்திலிருந்து', ['ம்'], [CASE.abl]], ['ட்டிலிருந்து', ['டு'], [CASE.abl]], ['ற்றிலிருந்து', ['று'], [CASE.abl]], ['யிலிருந்து', [''], [CASE.abl]], ['ிலிருந்து', ['்', 'ு'], [CASE.abl]],
    ['த்தில்', ['ம்'], [CASE.loc]], ['ட்டில்', ['டு'], [CASE.loc]], ['ற்றில்', ['று'], [CASE.loc]], ['யில்', [''], [CASE.loc]], ['வில்', [''], [CASE.loc]], ['ில்', ['்', 'ு'], [CASE.loc]],
    ['த்துக்கு', ['ம்'], [CASE.dat]], ['ட்டுக்கு', ['டு'], [CASE.dat]], ['ற்றுக்கு', ['று'], [CASE.dat]], ['வுக்கு', [''], [CASE.dat]], ['யுக்கு', [''], [CASE.dat]], ['ுக்கு', ['்'], [CASE.dat]], ['க்கு', [''], [CASE.dat]],
    ['த்தை', ['ம்'], [CASE.acc]], ['ட்டை', ['டு'], [CASE.acc]], ['ற்றை', ['று'], [CASE.acc]], ['யை', [''], [CASE.acc]], ['வை', [''], [CASE.acc]], ['ை', ['்'], [CASE.acc]],
    ['த்தின்', ['ம்'], [CASE.gen]], ['ட்டின்', ['டு'], [CASE.gen]], ['யின்', [''], [CASE.gen]], ['வின்', [''], [CASE.gen]], ['ின்', ['்'], [CASE.gen]], ['உடைய', [''], [CASE.gen]], ['ுடைய', ['்'], [CASE.gen]],
    ['த்தால்', ['ம்'], [CASE.ins]], ['யால்', [''], [CASE.ins]], ['ால்', ['்'], [CASE.ins]],
    ['த்துடன்', ['ம்'], [CASE.soc]], ['வுடன்', [''], [CASE.soc]], ['யுடன்', [''], [CASE.soc]], ['ுடன்', ['்'], [CASE.soc]],
    // verbs
    ['க்கிறேன்', [''], [V('present', '1sg', 'I …')]], ['க்கிறாய்', [''], [V('present', '2sg', 'you …')]], ['க்கிறான்', [''], [V('present', '3sg m', 'he …')]], ['க்கிறாள்', [''], [V('present', '3sg f', 'she …')]], ['க்கிறார்', [''], [V('present', '3sg hon', 'he/she (respectful) …')]], ['க்கிறது', [''], [V('present', '3sg n', 'it …')]], ['க்கிறோம்', [''], [V('present', '1pl', 'we …')]], ['க்கிறார்கள்', [''], [V('present', '3pl', 'they …')]],
    ['கிறேன்', ['', 'ு'], [V('present', '1sg', 'I …')]], ['கிறாய்', ['', 'ு'], [V('present', '2sg', 'you …')]], ['கிறான்', ['', 'ு'], [V('present', '3sg m', 'he …')]], ['கிறாள்', ['', 'ு'], [V('present', '3sg f', 'she …')]], ['கிறார்', ['', 'ு'], [V('present', '3sg hon', 'he/she (respectful) …')]], ['கிறது', ['', 'ு'], [V('present', '3sg n', 'it …')]], ['கிறோம்', ['', 'ு'], [V('present', '1pl', 'we …')]], ['கிறார்கள்', ['', 'ு'], [V('present', '3pl', 'they …')]],
    ['த்தேன்', [''], [V('past', '1sg', 'I …ed')]], ['த்தான்', [''], [V('past', '3sg m', 'he …ed')]], ['த்தாள்', [''], [V('past', '3sg f', 'she …ed')]], ['த்தார்', [''], [V('past', '3sg hon', 'he/she …ed')]], ['த்தது', [''], [V('past', '3sg n', 'it …ed')]], ['த்தோம்', [''], [V('past', '1pl', 'we …ed')]], ['த்தார்கள்', [''], [V('past', '3pl', 'they …ed')]],
    ['ட்டேன்', ['டு'], [V('past', '1sg', 'I …ed')]], ['ட்டான்', ['டு'], [V('past', '3sg m', 'he …ed')]], ['ட்டாள்', ['டு'], [V('past', '3sg f', 'she …ed')]],
    ['ினேன்', ['ு'], [V('past', '1sg', 'I …ed')]], ['ினான்', ['ு'], [V('past', '3sg m', 'he …ed')]], ['ினாள்', ['ு'], [V('past', '3sg f', 'she …ed')]], ['ினார்', ['ு'], [V('past', '3sg hon', 'he/she …ed')]],
    ['ப்பேன்', [''], [V('future', '1sg', 'I will …')]], ['வேன்', [''], [V('future', '1sg', 'I will …')]], ['வான்', [''], [V('future', '3sg m', 'he will …')]],
    ['க்கவில்லை', [''], [V('negative', 'any', 'did not / does not …')]], ['வில்லை', ['', 'ு'], [V('negative', 'any', 'did not / does not …')]], ['க்க', [''], [V('infinitive', '', 'to …')]],
  ],
  ml: [
    ['ട്ടിൽനിന്ന്', ['ട്'], [CASE.abl]], ['ട്ടിലേക്ക്', ['ട്'], [CASE.dat]], ['ത്തിലേക്ക്', ['ം'], [CASE.dat]], ['ത്തോടൊപ്പം', ['ം'], [CASE.soc]], ['ുകളിൽ', ['്'], [CASE.pl, CASE.loc]], ['ുകൾ', ['്'], [CASE.pl]],
    ['ങ്ങളിൽ', ['ം'], [CASE.pl, CASE.loc]], ['ങ്ങൾ', ['ം'], [CASE.pl]], ['കളിൽ', [''], [CASE.pl, CASE.loc]], ['കൾ', [''], [CASE.pl]],
    ['ത്തിൽനിന്ന്', ['ം'], [CASE.abl]], ['യിൽനിന്ന്', [''], [CASE.abl]], ['ിൽനിന്ന്', ['്'], [CASE.abl]],
    ['ത്തിൽ', ['ം'], [CASE.loc]], ['ട്ടിൽ', ['ട്'], [CASE.loc]], ['യിൽ', [''], [CASE.loc]], ['ിൽ', ['്'], [CASE.loc]],
    ['ത്തിന്', ['ം'], [CASE.dat]], ['യ്ക്ക്', [''], [CASE.dat]], ['ക്ക്', [''], [CASE.dat]], ['ിന്', ['്'], [CASE.dat]], ['ന്', ['ൻ'], [CASE.dat]],
    ['ത്തിന്റെ', ['ം'], [CASE.gen]], ['യുടെ', [''], [CASE.gen]], ['ിന്റെ', ['്'], [CASE.gen]], ['ന്റെ', ['ൻ'], [CASE.gen]], ['ുടെ', ['്'], [CASE.gen]],
    ['ത്തെ', ['ം'], [CASE.acc]], ['യെ', [''], [CASE.acc]], ['നെ', ['ൻ'], [CASE.acc]], ['ിനെ', ['്'], [CASE.acc]],
    ['ത്തോട്', ['ം'], [CASE.soc]], ['യോട്', [''], [CASE.soc]],
    ['ുന്നു', ['ുക'], [V('present', 'any', '…s / is …ing')]], ['ുന്നില്ല', ['ുക'], [V('negative present', 'any', 'does not …')]], ['ിച്ചു', ['ിക്കുക'], [V('past', 'any', '…ed')]], ['ച്ചു', ['ക്കുക'], [V('past', 'any', '…ed')]],
    ['ും', ['ുക'], [V('future', 'any', 'will …')]], ['ാൻ', ['ുക'], [V('infinitive', '', 'to …')]], ['ി', ['ുക'], [V('past', 'any', '…ed')]],
  ],
  kn: [
    ['ಗಳಲ್ಲಿ', [''], [CASE.pl, CASE.loc]], ['ಗಳಿಗೆ', [''], [CASE.pl, CASE.dat]], ['ಗಳನ್ನು', [''], [CASE.pl, CASE.acc]], ['ಗಳು', [''], [CASE.pl]],
    ['ದಿಂದ', [''], [CASE.abl]], ['ಯಿಂದ', [''], [CASE.abl]], ['ಿನಿಂದ', ['ು'], [CASE.abl]],
    ['ದಲ್ಲಿ', [''], [CASE.loc]], ['ಯಲ್ಲಿ', [''], [CASE.loc]], ['ಿನಲ್ಲಿ', ['ು'], [CASE.loc]], ['ಅಲ್ಲಿ', [''], [CASE.loc]],
    ['ಕ್ಕೆ', [''], [CASE.dat]], ['ಿಗೆ', ['ು'], [CASE.dat]], ['ಗೆ', [''], [CASE.dat]],
    ['ವನ್ನು', [''], [CASE.acc]], ['ಯನ್ನು', [''], [CASE.acc]], ['ನ್ನು', [''], [CASE.acc]], ['ವನ', [''], [CASE.gen]], ['ದ', [''], [CASE.gen]], ['ಯ', [''], [CASE.gen]],
    ['ಯುತ್ತಿದ್ದೇನೆ', [''], [V('present progressive', '1sg', 'I am …ing')]], ['ುತ್ತಿದ್ದೇನೆ', ['ು'], [V('present progressive', '1sg', 'I am …ing')]],
    ['ಯುತ್ತೇನೆ', [''], [V('non-past', '1sg', 'I … / I will …')]], ['ುತ್ತೇನೆ', ['ು'], [V('non-past', '1sg', 'I … / I will …')]], ['ುತ್ತಾನೆ', ['ು'], [V('non-past', '3sg m', 'he …')]], ['ುತ್ತಾಳೆ', ['ು'], [V('non-past', '3sg f', 'she …')]], ['ುತ್ತಾರೆ', ['ು'], [V('non-past', '3pl / hon', 'they …')]], ['ುತ್ತದೆ', ['ು'], [V('non-past', '3sg n', 'it …')]], ['ುತ್ತೇವೆ', ['ು'], [V('non-past', '1pl', 'we …')]],
    ['ಿದೆ', ['ು'], [V('past', '1sg', 'I …ed')]], ['ದೆ', [''], [V('past', '1sg', 'I …ed')]], ['ಿದನು', ['ು'], [V('past', '3sg m', 'he …ed')]], ['ದನು', [''], [V('past', '3sg m', 'he …ed')]],
    ['ಯಲು', [''], [V('infinitive', '', 'to …')]], ['ಲು', ['ು'], [V('infinitive', '', 'to …')]], ['ುವುದಿಲ್ಲ', ['ು'], [V('negative', 'any', 'will not / does not …')]],
  ],
  te: [
    ['లలో', [''], [CASE.pl, CASE.loc]], ['లకు', [''], [CASE.pl, CASE.dat]], ['లను', [''], [CASE.pl, CASE.acc]], ['లు', ['', 'ు'], [CASE.pl]],
    ['లో', [''], [CASE.loc]], ['కి', [''], [CASE.dat]], ['కు', [''], [CASE.dat]], ['ని', [''], [CASE.acc]], ['ను', [''], [CASE.acc]], ['తో', [''], [CASE.soc]], ['నుంచి', [''], [CASE.abl]], ['నుండి', [''], [CASE.abl]],
    ['తున్నాను', ['ు'], [V('present continuous', '1sg', 'I am …ing')]], ['తున్నాడు', ['ు'], [V('present continuous', '3sg m', 'he is …ing')]], ['తోంది', ['ు'], [V('present continuous', '3sg f/n', 'she/it is …ing')]], ['తున్నారు', ['ు'], [V('present continuous', '3pl', 'they are …ing')]], ['తున్నాము', ['ు'], [V('present continuous', '1pl', 'we are …ing')]],
    ['ుతున్నాను', ['ు'], [V('present continuous', '1sg', 'I am …ing')]], ['తాను', ['ు'], [V('future / habitual', '1sg', 'I will …')]], ['ుతాను', ['ు'], [V('future / habitual', '1sg', 'I will …')]],
    ['ాను', ['ు'], [V('past', '1sg', 'I …ed')]], ['ాడు', ['ు'], [V('past', '3sg m', 'he …ed')]], ['డానికి', ['ు'], [V('infinitive of purpose', '', 'in order to …')]],
  ],
};
// irregular forms that suffix rules cannot reach
const IRREGULAR = {
  ta: { 'வந்தேன்': ['வா', V('past', '1sg', 'I came')], 'வந்தான்': ['வா', V('past', '3sg m', 'he came')], 'வருகிறேன்': ['வா', V('present', '1sg', 'I am coming')], 'போனேன்': ['போ', V('past', '1sg', 'I went')], 'போனான்': ['போ', V('past', '3sg m', 'he went')], 'போனாள்': ['போ', V('past', '3sg f', 'she went')], 'வரவில்லை': ['வா', V('negative', 'any', 'did not come')] },
  ml: { 'വന്നു': ['വരുക', V('past', 'any', 'came')], 'പോയി': ['പോകുക', V('past', 'any', 'went')] },
  kn: { 'ಬಂದೆ': ['ಬಾ', V('past', '1sg', 'I came')], 'ಬಂತು': ['ಬಾ', V('past', '3sg n', 'it came')], 'ಹೋದೆ': ['ಹೋಗು', V('past', '1sg', 'I went')], 'ಹೋದನು': ['ಹೋಗು', V('past', '3sg m', 'he went')] },
  te: { 'ఇంట్లో': ['ఇల్లు', CASE.loc], 'ఇంటికి': ['ఇల్లు', CASE.dat], 'వచ్చాను': ['రా', V('past', '1sg', 'I came')], 'వెళ్ళాను': ['వెళ్ళు', V('past', '1sg', 'I went')], 'చదివాను': ['చదువు', V('past', '1sg', 'I read')] },
};
const SANDHI_TAIL = { ta: /(க்|ச்|த்|ப்)$/u }; // doubled consonant before the next word (வீட்டுக்குப்)
const ML_CHILLU = { 'ല്': 'ൽ', 'ന്': 'ൻ', 'ര്': 'ർ', 'ള്': 'ൾ', 'ണ്': 'ൺ' };

/**
 * Returns candidate analyses ordered from most to least specific:
 * [{ lemma, suffix, grammar: [..], kind: 'noun'|'verb' }]
 */
export function analyze(word, lang) {
  const w = normalizeText(word);
  if (!w) return [];
  const out = [];
  const seen = new Set();
  const push = (lemma, suffix, grammar) => {
    if (!lemma || lemma.length < 2 || lemma === w) return;
    if (lang === 'ml') for (const [k, v] of Object.entries(ML_CHILLU)) if (lemma.endsWith(k)) { const alt = lemma.slice(0, -k.length) + v; if (!seen.has(alt)) { seen.add(alt); out.push({ lemma: alt, suffix, grammar, kind: grammar[0]?.tense ? 'verb' : 'noun' }); } }
    if (seen.has(lemma)) return; seen.add(lemma);
    out.push({ lemma, suffix, grammar, kind: grammar[0]?.tense ? 'verb' : 'noun' });
  };
  const irr = IRREGULAR[lang]?.[w];
  if (irr) push(irr[0], w, [irr[1]]);
  if (SANDHI_TAIL[lang]?.test(w) && w.length > 3) { const base = w.replace(SANDHI_TAIL[lang], ''); for (const a of analyze(base, lang)) push(a.lemma, a.suffix, a.grammar); }
  for (const [suffix, restores, grammar] of RULES[lang] || []) {
    if (!w.endsWith(suffix) || w.length <= suffix.length + 1) continue;
    const stem = w.slice(0, -suffix.length);
    for (const r of restores) push(stem + r, suffix, grammar);
  }
  return out;
}

/** Plain-English gloss for an inflected form, e.g. கிராமத்தில் → "in the village". */
export function composeGloss(grammar, lemmaEnglish) {
  const g = grammar || [];
  const noun = String(lemmaEnglish || '').split(/[;,]/)[0].replace(/^(?:to |the |an? )/i, '').trim();
  const plural = g.some((x) => x.case === 'plural');
  const n = plural ? `${noun}${/s$/.test(noun) ? '' : 's'}` : noun;
  const c = g.find((x) => x.case && x.case !== 'plural');
  if (c) return { locative: `in / at the ${n}`, dative: `to / for the ${n}`, accusative: `the ${n} (as the object)`, genitive: `of the ${n}`, ablative: `from the ${n}`, instrumental: `by / with the ${n}`, sociative: `with the ${n}` }[c.case] || n;
  if (plural) return n;
  const v = g.find((x) => x.tense);
  if (v) return `${v.en.replace('…ing', `${noun}ing`).replace('…ed', `${noun} (past)`).replace('…s', `${noun}s`).replace('…', noun)}`.replace(/eing\b/, 'ing');
  return noun;
}
export const describe = (grammar) => (grammar || []).map((x) => (x.case ? `${x.case} (${x.en})` : `${x.tense}${x.person ? `, ${x.person}` : ''}`)).join(' + ');
