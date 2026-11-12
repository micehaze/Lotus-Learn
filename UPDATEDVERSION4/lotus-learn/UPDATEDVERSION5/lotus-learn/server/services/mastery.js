// Lotus mastery rules (PRD §11, §12.2).
//  - one lotus per completed 10-correct word per calendar learning day
//  - display caps at 5 (fully bloomed); later reviews keep counting in successful_days
//  - normalised mastery score 0..100:
//      0 lotuses: 0..15 from in-progress correct answers (0–10 correct = initial learning)
//      n lotuses: n*20 (+ up to 15 for in-progress answers towards the next lotus)
//      5 lotuses: 100

export const MAX_LOTUS = 5;

export function lotusStage(successfulDays) {
  return Math.min(MAX_LOTUS, Math.max(0, Number(successfulDays) || 0));
}

export function masteryScore(m) {
  if (!m) return 0;
  const stage = lotusStage(m.successful_days ?? m.successfulDays);
  if (stage >= MAX_LOTUS) return 100;
  const partial = Math.min(10, Math.max(0, Number(m.current_correct ?? m.currentCorrect) || 0));
  return Math.round(stage * 20 + partial * 1.5);
}

export function masteryView(m) {
  const days = Number(m?.successful_days ?? 0);
  return {
    lotus: lotusStage(days),
    successfulDays: days,
    currentCorrect: Number(m?.current_correct ?? 0),
    totalCorrect: Number(m?.total_correct ?? 0),
    totalIncorrect: Number(m?.total_incorrect ?? 0),
    lastRewardDate: m?.last_reward_date || null,
    score: masteryScore(m),
  };
}
