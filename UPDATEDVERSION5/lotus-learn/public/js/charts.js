// Hand-built SVG charts (no external library): histogram, radar, daily bars.
import { h, raw, esc } from './core.js';

export function histogram(words, { height = 260 } = {}) {
  if (!words.length) return h`<p class="muted">No data yet.</p>`;
  const max = Math.max(10, ...words.map((w) => Math.max(w.correct, w.incorrect)));
  const bw = 16, gap = 30, left = 36, top = 14, bottom = 78;
  const W = Math.max(520, left + words.length * (bw * 2 + gap) + 10);
  const H = height;
  const ih = H - top - bottom;
  const y = (v) => top + ih - (v / max) * ih;
  let g = '';
  for (let t = 0; t <= max; t += max > 20 ? 5 : 2) g += `<line x1="${left}" x2="${W}" y1="${y(t)}" y2="${y(t)}" stroke="#B7DDD9" stroke-dasharray="3 3"/><text x="${left - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
  words.forEach((w, i) => {
    const x = left + 12 + i * (bw * 2 + gap);
    g += `<rect class="bar" style="animation-delay:${i * 40}ms" x="${x}" y="${y(w.correct)}" width="${bw}" height="${(w.correct / max) * ih}" fill="#3DBCA8" stroke="#0B5560" stroke-width="2"><title>${esc(w.tamil)}: ${w.correct} correct</title></rect>`;
    g += `<rect class="bar" style="animation-delay:${i * 40 + 20}ms" x="${x + bw}" y="${y(w.incorrect)}" width="${bw}" height="${(w.incorrect / max) * ih}" fill="#FF6F61" stroke="#0B5560" stroke-width="2"><title>${esc(w.tamil)}: ${w.incorrect} incorrect</title></rect>`;
    g += `<text class="ta-label" transform="translate(${x + bw},${H - bottom + 16}) rotate(-35)" text-anchor="end">${esc(w.tamil.length > 14 ? `${w.tamil.slice(0, 13)}…` : w.tamil)}</text>`;
  });
  return h`<div class="chart"><svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="Correct and incorrect answers per word">${raw(g)}<line x1="${left}" x2="${W}" y1="${top + ih}" y2="${top + ih}" stroke="#0B5560" stroke-width="2"/></svg></div>
    <div class="legend"><span><i style="background:#3DBCA8"></i>Correct answers</span><span><i style="background:#FF6F61"></i>Incorrect answers</span></div>
    <table class="visually-hidden"><caption>Answers per word</caption><tr><th>Word</th><th>Correct</th><th>Incorrect</th></tr>${words.map((w) => h`<tr><td>${w.tamil}</td><td>${w.correct}</td><td>${w.incorrect}</td></tr>`)}</table>`;
}

export function radar(items, { size = 420, label = 'Mastery radar' } = {}) {
  const n = items.length;
  if (n < 3) return h`<p class="muted">The radar chart needs at least three items. ${n ? 'Current values are listed below.' : ''}</p>${list(items)}`;
  const S = size, c = S / 2, R = S / 2 - 70;
  const pt = (i, v) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [c + Math.cos(a) * R * (v / 100), c + Math.sin(a) * R * (v / 100)]; };
  let g = '';
  for (const lv of [20, 40, 60, 80, 100]) g += `<polygon points="${items.map((_, i) => pt(i, lv).join(',')).join(' ')}" fill="${lv === 100 ? '#F5FFFD' : 'none'}" stroke="#B7DDD9" stroke-width="${lv === 100 ? 2 : 1}"/>`;
  items.forEach((_, i) => { const [x, y] = pt(i, 100); g += `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="#B7DDD9"/>`; });
  g += `<polygon class="radar-shape" points="${items.map((it, i) => pt(i, Math.max(2, it.value)).join(',')).join(' ')}" fill="rgba(255,138,115,.45)" stroke="#E8644F" stroke-width="3" stroke-linejoin="round"/>`;
  items.forEach((it, i) => {
    const [x, y] = pt(i, Math.max(2, it.value));
    g += `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" fill="#2FD3E0" stroke="#0B5560" stroke-width="2"><title>${esc(it.label)}: ${it.value}</title></rect>`;
    const [lx, ly] = pt(i, 122);
    const anchor = Math.abs(lx - c) < 10 ? 'middle' : lx > c ? 'start' : 'end';
    const lab = it.label.length > 16 ? `${it.label.slice(0, 15)}…` : it.label;
    g += `<text class="${it.tamil ? 'ta-label' : ''}" x="${lx}" y="${ly + 4}" text-anchor="${anchor}">${esc(lab)}</text><text x="${lx}" y="${ly + 19}" text-anchor="${anchor}" fill="#3E5E66" font-size="11">${it.value}</text>`;
  });
  return h`<div class="chart"><svg viewBox="0 0 ${S} ${S}" width="${S}" role="img" aria-label="${label}">${raw(g)}</svg></div>${list(items, true)}`;
}
function list(items, hidden = false) {
  return h`<table class="tbl ${hidden ? 'visually-hidden' : ''}"><tr><th>Item</th><th>Mastery (0–100)</th></tr>${items.map((i) => h`<tr><td>${i.label}</td><td>${i.value}</td></tr>`)}</table>`;
}

export function dailyBars(days) {
  const max = Math.max(5, ...days.map((d) => d.correct + d.incorrect));
  const W = 620, H = 170, left = 30, top = 10, bottom = 26, ih = H - top - bottom, bw = (W - left) / days.length;
  let g = '';
  days.forEach((d, i) => {
    const x = left + i * bw + 2;
    const hc = (d.correct / max) * ih, hi = (d.incorrect / max) * ih;
    g += `<rect class="bar" x="${x}" y="${top + ih - hc}" width="${bw - 4}" height="${hc}" fill="#3DBCA8"><title>${d.date}: ${d.correct} correct</title></rect>`;
    g += `<rect class="bar" x="${x}" y="${top + ih - hc - hi}" width="${bw - 4}" height="${hi}" fill="#FF6F61"><title>${d.date}: ${d.incorrect} incorrect</title></rect>`;
    if (d.lotuses) g += `<rect x="${x + bw / 2 - 5}" y="${top + ih - hc - hi - 12}" width="8" height="8" fill="#FF4D8D" stroke="#0B5560"><title>${d.lotuses} lotus reward(s)</title></rect>`;
    if (i % 5 === 0 || i === days.length - 1) g += `<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="10">${d.date.slice(5)}</text>`;
  });
  return h`<div class="chart"><svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="Answers per day, last 30 days">${raw(g)}<line x1="${left}" x2="${W}" y1="${top + ih}" y2="${top + ih}" stroke="#0B5560" stroke-width="2"/><text x="${left - 4}" y="${top + 8}" text-anchor="end" font-size="10">${max}</text></svg></div>
  <div class="legend"><span><i style="background:#3DBCA8"></i>Correct</span><span><i style="background:#FF6F61"></i>Incorrect</span><span><i style="background:#FF4D8D"></i>Lotus earned</span></div>`;
}
