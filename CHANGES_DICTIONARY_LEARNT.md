# Dictionary engine, Learnt and content-rule fixes — status report

## What was found
An earlier partial pass had already written the lookup engine (`server/services/lookup.js`), providers
(`server/integrations/dictionaryProviders.js`), morphology (`shared/morphology.js`), Learnt (`server/services/learnt.js`),
Daily-Topic completeness rules and migration `003_dictionary_engine.sql`, but **none of it was connected to the app**, there
was no UI, and 3 tests were failing. This pass connected and verified it rather than writing a second engine.
(One mistake on the way: some of those files were briefly overwritten; they were restored byte-for-byte from a backup taken
before any change, and the duplicate migration I had started was removed.)

## Fixed / implemented in this pass
* Dictionary search and Reader lookups now use the layered engine: local library → morphology (inflected forms → lemma,
  with the grammatical meaning, e.g. கிராமத்தில் = கிராமம் + locative “in the village”) → Wiktionary → translation
  providers with failover (Google, Azure, LibreTranslate) → AI → persistent cache. Same engine for Dictionary and Reading.
* Provider outages show a short “try again” message; nothing is invented to hide a failure.
* Public entries no longer show editorial/diagnostic messages (kept for admins via `?admin` views and the review queue).
  Automatically validated AI rows are shown with a small “AI-assisted” flag.
* Example sentences and cross-language equivalents are separate typed items (`kind: sentence | equivalent`).
* Learnt: `/api/learnt` + a Learnt panel in Vocabulary. Rule: ≥10 correct answers on each of 3 distinct days (learner time
  zone); 30 on one day does not count; per language; updated when a lesson completes; history back-filled at start-up.
* Public vocabulary lists require ≥ 40 words (`list_min_words`); Daily Topics are only published at ≥ 60 words.
  Smaller lists/topics remain in the database (nothing deleted).

## Tests
`npm test`: **55/55** (incl. new `dictionary-engine.test.js`: “sex”→Tamil, “discover”→Malayalam, “go”→Kannada,
“love”→Telugu, கிராமத்தில்→கிராமம், offline morphology in all four languages, cache reuse, outage handling, typed
sentences/equivalents, hidden diagnostics, ≥40-word lists, ≥60-word topics, the full Learnt rule). External providers are
tested with mocks that follow the real provider contract — **not against live services** (no internet in the build sandbox).

## NOT done in this pass (honest list)
* **Content volume.** Without provider/AI keys the library is still small, so with the new rules few lists or Daily Topics
  are public yet. Adding ~90 more core words per language and topic-group expansion were planned but not completed.
* **10–15 synonyms/antonyms/collocations, 5–7 examples per entry** depend on AI enrichment (needs a key).
* **Visual redesign** (distinct backgrounds for 11 sections × 4 languages, the seven new Kannada/Telugu references, Malayalam
  rice paddies/coconut palms, Tamil jasmine/pillar changes, 77-lotus login river) was **not started**. The Pinterest link
  could not be opened from the sandbox.

## Keys needed
`GOOGLE_TRANSLATE_API_KEY` or `AZURE_TRANSLATOR_KEY`(+`AZURE_TRANSLATOR_REGION`) or `LIBRETRANSLATE_URL` for broad coverage;
`ANTHROPIC_API_KEY`/`OPENAI_API_KEY` for sense-aware translations and enrichment. Wiktionary needs no key.
