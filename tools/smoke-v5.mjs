import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeClient } from '../tests/helpers.js';
const c = makeClient(process.env.SMOKE_URL || 'http://127.0.0.1:3005');
const login = await c.post('/api/auth/login', {email: 'demo@lotuslearn.local', password: 'lotus-demo-2026'});
assert.equal(login.status, 200);
const report = {lookups: [], completion: null, generatedFallback: []};
for (const lang of ['ta','ml','kn','te']) for (const q of ['mother','grandmother','village','craft','beauty','cat','dog']) {
 const r = await c.get(`/api/dictionary/search?dict=${lang}&direction=from_en&q=${q}`);
 assert.equal(r.status,200); assert.ok(r.data.results.length, `${lang}: ${q}`);
 report.lookups.push({lang, query: q, count: r.data.results.length, first: r.data.results[0].native});
}
console.log('28 real-data searches passed.');
for (const [lang,q] of [['ta','authentic'],['te','aesthetic']]) {
 const r = await c.get(`/api/dictionary/search?dict=${lang}&direction=from_en&q=${q}`);
 assert.equal(r.status,200); assert.ok(r.data.results.length, `${lang}: generated ${q}`);
 report.generatedFallback.push({lang,query:q,result:r.data.results[0]});
 console.log(`Generated translation passed: ${lang}/${q}`);
}
const beauty = await c.get('/api/dictionary/search?dict=ta&direction=to_en&q='+encodeURIComponent('அழகு'));
assert.ok(beauty.data.results.length);
const id=beauty.data.results[0].id;
const done = await c.post(`/api/dictionary/entries/${id}/complete`);
assert.equal(done.status,200);
const examples=done.data.entry.senses.flatMap(s=>s.examples);
assert.ok(examples.filter(x=>x.aiAssisted).every(x=>/[.!?।]$/.test(x.native.trim()) && /[.!?]$/.test(x.english.trim())), 'generated examples must be punctuated complete statements');
assert.ok(examples.some(x=>x.aiAssisted), 'real local model generated examples must be visible and labelled');
assert.ok(done.data.entry.senses[0].equivalents.some(x=>x.lang==='ml'));
report.completion=done.data;
fs.mkdirSync('verification',{recursive:true});
fs.writeFileSync('verification/live-dictionary.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({examples:examples.length,generated:examples.filter(x=>x.aiAssisted).length,errors:done.data.report.errors}));
