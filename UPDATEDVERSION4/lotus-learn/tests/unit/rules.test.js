import { test } from 'node:test';
import assert from 'node:assert/strict';
import { masteryScore, lotusStage } from '../../server/services/mastery.js';
import { computeStreak } from '../../server/services/stats.js';
import { parseCSV } from '../../server/services/content.js';
import { assessDifficulty } from '../../server/services/library.js';
import { parseYouTubeId, parseISODuration } from '../../server/integrations/index.js';
import { localDate } from '../../server/util.js';

test('lotus stage caps at five; score is normalised 0..100', () => {
  assert.equal(lotusStage(0), 0);
  assert.equal(lotusStage(3), 3);
  assert.equal(lotusStage(9), 5);
  assert.equal(masteryScore({ successful_days: 0, current_correct: 0 }), 0);
  assert.equal(masteryScore({ successful_days: 0, current_correct: 10 }), 15);
  assert.equal(masteryScore({ successful_days: 2, current_correct: 0 }), 40);
  assert.equal(masteryScore({ successful_days: 4, current_correct: 10 }), 95);
  assert.equal(masteryScore({ successful_days: 5, current_correct: 3 }), 100);
  assert.equal(masteryScore({ successful_days: 12 }), 100);
});

test('streaks count consecutive active days', () => {
  assert.deepEqual(computeStreak(['2026-11-06', '2026-11-07', '2026-11-08'], '2026-11-08'), { current: 3, longest: 3, activeToday: true });
  assert.equal(computeStreak(['2026-11-06', '2026-11-07'], '2026-11-08').current, 2, 'yesterday keeps the streak alive');
  assert.equal(computeStreak(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-07'], '2026-11-08').longest, 3);
  assert.equal(computeStreak([], '2026-11-08').current, 0);
});

test('calendar day honours the learner time zone', () => {
  const t = '2026-11-08T22:30:00Z';
  assert.equal(localDate(t, 'UTC'), '2026-11-08');
  assert.equal(localDate(t, 'Asia/Kolkata'), '2026-11-09');
  assert.equal(localDate(t, 'America/Los_Angeles'), '2026-11-08');
});

test('CSV parser handles quotes, commas and newlines', () => {
  const rows = parseCSV('tamil,english,example_en\n"வீடு","house","a ""big"", house"\nமரம்,tree,"line1\nline2"\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].example_en, 'a "big", house');
  assert.equal(rows[1].example_en, 'line1\nline2');
});

test('difficulty heuristic separates simple and complex prose', () => {
  const easy = assessDifficulty([{ ta: 'மீனா எழுந்தாள். அவள் காபி குடித்தாள்.' }]);
  const hard = assessDifficulty([{ ta: 'சுற்றுச்சூழல் பாதுகாப்பு குறித்த விரிவான கலந்துரையாடல் நடைபெற்றபோது, பல்வேறு துறைகளைச் சேர்ந்த வல்லுநர்கள் தங்களுடைய அனுபவங்களையும் பரிந்துரைகளையும் ஆழமாகப் பகிர்ந்துகொண்டனர்.' }]);
  assert.equal(easy.suggestedLevel, 'A1');
  assert.ok(['C1', 'C2', 'B2'].includes(hard.suggestedLevel), hard.suggestedLevel);
});

test('YouTube helpers', () => {
  assert.equal(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseYouTubeId('not a link'), null);
  assert.equal(parseISODuration('PT1H2M3S'), 3723);
  assert.equal(parseISODuration('PT45S'), 45);
});
