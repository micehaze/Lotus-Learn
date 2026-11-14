import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../../server/app.js';
import {seed} from '../../server/seed/seed.js';
import {addDays} from '../../server/util.js';
import {LANG_CODES} from '../../shared/indic.js';
import {validateDailyEntries,lexicalIdentity} from '../../server/services/dailyTopicAutomation.js';
import {curriculumCatalog} from '../../server/services/microtopicCatalog.js';
import {registerUser,makeClient} from '../helpers.js';

// Synthetic script-valid expressions test software rules only, never linguistic authenticity.
const roots={ta:['மரம்','க'],ml:['മരം','ക'],kn:['ಮರ','ಕ'],te:['చెట్టు','క']};
function entries(lang,count=30,salt=''){
 const [root,letter]=roots[lang];
 return Array.from({length:count},(_,i)=>({native:root+' '+salt+letter.repeat(i+1),english:`structural fixture ${i}`,lemma:root+salt+letter.repeat(i+1),level:i%2?'C1':'A1',pos:'idiom',construction:i%2?'verb_object':'adj_noun',register:'common'}));
}
function model(){
 let call=0;
 return {configured:true,model:'structural-fixture-only',provider:'ollama',
  async completeJSON({system,prompt}){
   if(system.startsWith('Review ')) {
    const list=JSON.parse(prompt.split('Entries: ')[1].split('. Return ')[0]);
    return {reviews:list.map((e)=>({index:e.index,ok:true,issues:[]}))};
   }
   const lang=system.includes('Tamil')?'ta':system.includes('Malayalam')?'ml':system.includes('Kannada')?'kn':'te';
   // Unique per generation request, including historical days.
   const salt=roots[lang][1].repeat(++call)+' ';
   return {entries:entries(lang,10,salt)};
  }};
}
async function setup({file=':memory:',instant='2026-03-06T18:00:00Z',ai=model(),config={},corroborate=true,dictionary={}}={}){
 let current=new Date(instant);
 const clock={now:()=>new Date(current),set:d=>{current=new Date(d);}};
 const providers={enabled:corroborate,status:()=>[],configured:()=>corroborate,
   async lookupNative(native){return {entries:[{native,source:'test fixture',english:'structural fixture'}]};},...dictionary};
 const app=createApp({databaseFile:file,testMode:true,automationEnabled:false,dailyTopicEnabled:false,appTimezone:'Asia/Bangkok',ai:{provider:'none'},...config},{ai,clock,logger:{log(){},warn(){},error:console.error},providers});
 await seed(app,{demoUsers:false});
 return {app,clock,daily:app.services.dailyTopics,db:app.db,close:()=>app.close()};
}

test('400 consecutive calendar dates reserve distinct canonical microtopics and exactly four durable jobs each',async()=>{
 const s=await setup();try{
  for(let i=0;i<400;i++){
   const date=addDays('2026-03-07',i),d=s.daily.reserve(date);
   assert.equal(s.daily.reserve(date).id,d.id);
   assert.deepEqual(s.db.all('SELECT language_code FROM daily_topic_language_sets WHERE date_id=? ORDER BY language_code',d.id).map(x=>x.language_code),[...LANG_CODES].sort());
  }
  assert.equal(s.db.get('SELECT COUNT(DISTINCT topic_date) n FROM daily_topic_dates').n,400);
  assert.equal(s.db.get('SELECT COUNT(DISTINCT microtopic_id) n FROM daily_topic_dates').n,400);
  assert.equal(s.db.get('SELECT COUNT(DISTINCT title) n FROM daily_topic_dates').n,400);
  assert.equal(s.db.get('SELECT COUNT(*) n FROM topic_generation_jobs').n,1600);
  const catalog=curriculumCatalog();assert.ok(catalog.length>=960);
  assert.ok(catalog.some(t=>t.title.includes('everyday actions')));
 }finally{await s.close();}
});

test('all four scripts enforce 20–50, normalized uniqueness, collocations and strict historical reuse',()=>{
 for(const lang of LANG_CODES){
  assert.equal(validateDailyEntries(entries(lang,20),lang).ok,true);
  assert.equal(validateDailyEntries(entries(lang,50),lang).ok,true);
  for(const list of [[],entries(lang,19),entries(lang,51),[...entries(lang,20),entries(lang,20)[0]],null,[...entries(lang,20),null]])assert.equal(validateDailyEntries(list,lang).ok,false);
  const list=entries(lang,20),history=new Set(list.slice(0,3).map(e=>lexicalIdentity(e.native)));
  assert.equal(validateDailyEntries(list,lang,history).ok,true);history.add(lexicalIdentity(list[3].native));
  assert.equal(validateDailyEntries(list,lang,history).ok,false);
  assert.equal(validateDailyEntries(list.map(e=>({...e,construction:'word'})),lang).ok,false);
  assert.equal(validateDailyEntries(list.map(e=>({...e,native:e.native+' fake'})),lang).ok,false);
 }
 assert.equal(lexicalIdentity(' மரம்! '),lexicalIdentity('மரம்'));
});

test('400-day publication simulation: 1,600 complete language lists, 32,000 entries, no historical overlap',async()=>{
 const s=await setup();try{
  const vocab=new Map(LANG_CODES.map(lang=>[lang,s.app.services.vocabulary.create({native:roots[lang][0],english:'structural fixture',part_of_speech:'noun',level:'A1'},{lang})]));
  for(let i=0;i<400;i++){
   const date=addDays('2026-03-07',i);s.clock.set(date+'T05:00:00Z');const d=s.daily.reserve(date);
   for(const lang of LANG_CODES){
    const set=s.db.get('SELECT id FROM daily_topic_language_sets WHERE date_id=? AND language_code=?',d.id,lang);
    const salt=(i+1).toString(2).replace(/0/g,roots[lang][0]).replace(/1/g,roots[lang][1])+' ';
    for(const [position,entry] of entries(lang,20,salt).entries()){
     const e={...entry,provenance:{review:{ok:true,model:'synthetic-test-fixture'}}};
     s.db.run('INSERT INTO daily_study_entries(language_set_id,vocabulary_id,position,identity_key,lemma_key,construction,payload) VALUES(?,?,?,?,?,?,?)',set.id,vocab.get(lang),position,lexicalIdentity(e.native),lexicalIdentity(e.lemma),e.construction,JSON.stringify(e));
    }
    s.db.run("UPDATE daily_topic_language_sets SET status='ready',word_count=20 WHERE id=?",set.id);
   }
   assert.equal(s.daily.publish(d.id),true);
  }
  assert.equal(s.db.get("SELECT COUNT(*) n FROM daily_topic_dates WHERE status='published'").n,400);
  const languages=s.db.all('SELECT s.language_code,COUNT(DISTINCT s.id) lessons,COUNT(e.id) entries,MIN(s.word_count) minimum,MAX(s.word_count) maximum,COUNT(DISTINCT e.identity_key) distinctEntries FROM daily_topic_language_sets s JOIN daily_study_entries e ON e.language_set_id=s.id GROUP BY s.language_code');
  for(const lang of languages){assert.equal(lang.lessons,400);assert.equal(lang.entries,8000);assert.equal(lang.distinctEntries,8000);assert.equal(lang.minimum,20);assert.equal(lang.maximum,20);}
  const report={days:400,publishedCanonicalDates:400,languageLists:1600,entries:32000,languages,fixtureType:'Synthetic script-valid expressions; tests persistence and publication constraints, not linguistic quality.'};
  const out=new URL('../../verification/daily-topic-400-day-result.json',import.meta.url);fs.mkdirSync(new URL('.',out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));
 }finally{await s.close();}
});

test('real SQLite jobs atomically publish four reviewed lists; API reads, levels, archive and collection saves work',async()=>{
 const s=await setup();try{
  const before=s.app.services.content.version('ta');
  const result=await s.daily.tick();assert.equal(result.failed,0);assert.equal(result.published.length,1);
  const day=s.daily.today('ta'),id=day.canonicalId;assert.equal(day.status,'published');
  for(const lang of LANG_CODES){const t=s.daily.today(lang);assert.equal(t.title,day.title);assert.equal(t.date,day.date);assert.equal(t.words.length,30);assert.equal(t.words[0].lang,lang);}
  assert.notDeepEqual(s.app.services.content.version('ta'),before);
  assert.equal(s.daily.today('ta',{level:'A1'}).words[0].level,'A1');
  assert.equal(s.daily.today('ta',{level:'C1'}).words[0].level,'C1');
  assert.equal(s.daily.get(day.id,{lang:'te'}).lang,'te');
  assert.equal(s.daily.archive('ta',{from:day.date,to:day.date}).items[0].id,day.id);
  assert.throws(()=>s.daily.retry(id,'ta'),/immutable/);
  assert.throws(()=>s.db.run('DELETE FROM daily_study_entries WHERE language_set_id IN (SELECT id FROM daily_topic_language_sets WHERE date_id=?)',id),/immutable/);
  assert.throws(()=>s.daily.adminSet('ta',{date:day.date}),/shared microtopic/);
  await new Promise(r=>s.app.server.listen(0,'127.0.0.1',r));
  const c=makeClient(`http://127.0.0.1:${s.app.server.address().port}`);await registerUser(c);
  const topic=await c.get(`/api/daily-topic/${day.id}?lang=ta`);assert.equal(topic.status,200);
  const col=(await c.post('/api/collections',{title:'From archived topic'})).data.id;
  assert.equal((await c.post(`/api/collections/${col}/words`,{vocabularyIds:[day.words[0].id],source:'list',sourceRef:`daily-topic:${day.id}`})).data.added,1);
  assert.equal((await c.get(`/api/collections/${col}`)).data.words[0].tamil,day.words[0].tamil);
  assert.equal(s.daily.get(day.id).words.length,30);
 }finally{await s.close();}
});

test('restart after two missing days catches up in order; published history remains immutable and readable without Ollama',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lotus-daily-')),file=path.join(dir,'test.db');
 let s=await setup({file});
 try{
  await s.daily.tick();const first=s.daily.today('ta');
  // Emulate an existing installation immediately before the new integrity migration.
  for(const row of s.db.all("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'daily_published_%'"))s.db.exec(`DROP TRIGGER ${row.name}`);
  s.db.run("DELETE FROM schema_migrations WHERE version='006_daily_topic_integrity.sql'");
  await s.close();
  s=await setup({file,instant:'2026-03-09T18:00:00Z'});
  for(let i=0;i<3;i++)assert.equal((await s.daily.tick()).published.length,1);
  assert.deepEqual(s.db.all("SELECT topic_date FROM daily_topic_dates WHERE status='published' ORDER BY topic_date").map(x=>x.topic_date),['2026-03-07','2026-03-08','2026-03-09','2026-03-10']);
  assert.deepEqual(s.daily.get(first.id).words.map(e=>e.native),first.words.map(e=>e.native));
  await s.close();s=await setup({file,instant:'2026-03-10T18:00:00Z',ai:{configured:false}});
  assert.equal(s.daily.get(first.id).words.length,30);
  const r=await s.daily.tick();assert.ok(r.failed>0);assert.equal(s.daily.today('ta').date,'2026-03-10');
  // Without Ollama the job runs in offline mode; with no dictionary to search it explains what is missing.
  assert.ok(s.daily.status({admin:true}).jobs.some(j=>j.error_summary?.includes('Offline mode')&&j.error_summary.includes('offline dictionary')));
  assert.ok(fs.readdirSync(path.join(dir,'backups')).length>0);
 }finally{await s.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('dictionary retrieval starts generation and checks competing senses with back translation',async()=>{
 const delegate=model();
 const requests=[];
 const ai={...delegate,async completeJSON(request){
   requests.push(request.system);
   if(request.system.startsWith('Suggest precise'))return {glosses:['fixture phrase']};
   return delegate.completeJSON(request);
 }};
 const s=await setup({ai,dictionary:{
   async health(){return {ok:true,translator:{available:true}};},
   async lookupEnglish(gloss,lang,options){
     assert.equal(options.lexiconOnly,true);
     return {candidates:['மரம் க','மரம் ச'].map(native=>({native,english:gloss,basis:'fixture translation table',sense:'fixture usage',score:100}))};
   },
   async translate({text,allowAI}){
     assert.equal(allowAI,false);
     return {engine:'IndicTrans2',text:text==='மரம் ச'?'fixture phrase':'different meaning'};
   },
 }});
 try{
   await s.daily.tick({maxJobs:1});
   const draft=s.daily.inspect(1).languages.find(set=>set.language_code==='ta');
   assert.match(requests[0],/^Suggest precise/);
   assert.equal(draft.entries[0].english,'fixture phrase');
   assert.equal(draft.entries[0].native,'மரம் ச');
   assert.equal(draft.entries[0].provenance.dictionaryEvidence[0].source,'fixture translation table');
 }finally{await s.close();}
});

test('AI approval without dictionary or translation evidence cannot fill a language list',async()=>{
 const s=await setup({corroborate:false});
 try{
   assert.equal((await s.daily.tick({maxJobs:1})).failed,1);
   assert.equal(s.daily.inspect(1).languages.find(set=>set.language_code==='ta').word_count,0);
 }finally{await s.close();}
});

test('reviewed entries survive a later model timeout and are reused on retry',async()=>{
 const delegate=model();
 let generationRequests=0;
 const ai={...delegate,async completeJSON(request){
   if(!request.system.startsWith('Review ')&&++generationRequests===2){
     throw Object.assign(new Error('Request timed out'),{code:'network_error'});
   }
   return delegate.completeJSON(request);
 }};
 const s=await setup({ai});
 try{
   const result=await s.daily.tick({maxJobs:1});
   assert.equal(result.failed,1);
   const day=s.daily.inspect(1);
   const draft=day.languages.find(set=>set.language_code==='ta');
   assert.equal(draft.word_count,10);
   assert.ok(draft.entries.every(entry=>entry.provenance.review.ok));
   assert.equal(s.daily.today('ta').words.length,0);

   s.daily.retry(day.id,'ta');
   assert.equal((await s.daily.tick({maxJobs:1})).completed,1);
   const ready=s.daily.inspect(day.id).languages.find(set=>set.language_code==='ta');
   assert.equal(ready.word_count,30);
   assert.deepEqual(ready.entries.slice(0,10),draft.entries);
 }finally{await s.close();}
});

test('a date that exhausts retries keeps its reservation without blocking the next date',async()=>{
 const s=await setup();
 try{
   const blocked=s.daily.reserve('2026-03-07');
   s.db.run("UPDATE topic_generation_jobs SET status='failed',attempt_count=5 WHERE date_id=? AND language_code='ta'",blocked.id);
   s.db.run("UPDATE daily_topic_dates SET status='failed' WHERE id=?",blocked.id);
   s.clock.set('2026-03-07T18:00:00Z');
   const later=s.daily.reserve('2026-03-08');
   assert.deepEqual((await s.daily.tick()).published,[later.id]);
   assert.equal(s.daily.inspect(blocked.id).status,'failed');
   assert.equal(s.daily.reserve(blocked.topic_date).microtopic_id,blocked.microtopic_id);

   s.daily.retry(blocked.id,'ta');
   assert.deepEqual((await s.daily.tick()).published,[blocked.id]);
   assert.equal(s.daily.archive('ta').total,2);
 }finally{await s.close();}
});

test('pending date is honest; simultaneous workers and stale leases cannot duplicate or publish incomplete content',async()=>{
 const s=await setup();try{
  const pending=s.daily.today('kn');assert.equal(pending.words.length,0);assert.notEqual(pending.status,'published');
  const result=await Promise.all([s.daily.tick(),s.daily.tick()]);assert.ok(result.some(x=>x.busy));
  assert.equal(s.db.get("SELECT COUNT(*) n FROM daily_topic_dates WHERE status='published'").n,1);
  s.clock.set('2026-03-07T18:00:00Z');s.daily.reserveDue();
  const d=s.db.get("SELECT * FROM daily_topic_dates WHERE topic_date='2026-03-08'");
  await assert.rejects(s.daily.generate(d,'ta',{id:999999,token:'expired'}),/lease expired/);
  assert.equal(s.daily.publish(d.id),false);
  assert.equal(s.db.get('SELECT COUNT(*) n FROM daily_study_entries e JOIN daily_topic_language_sets s ON s.id=e.language_set_id WHERE s.date_id=?',d.id).n,0);
 }finally{await s.close();}
});

test('server scheduler publishes five successive dates without a browser or HTTP listener',async()=>{
 const s=await setup({config:{dailyTopicEnabled:true,dailyTopicScanMs:10}});try{
  s.app.startScheduler();
  for(let i=0;i<5;i++){
   const date=addDays('2026-03-07',i);s.clock.set(date+'T05:00:00Z');
   const deadline=Date.now()+5000;
   while(!s.db.get("SELECT id FROM daily_topic_dates WHERE topic_date=? AND status='published'",date)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
   assert.equal(s.daily.today('te').date,date);
   assert.equal(s.daily.today('te').status,'published');
  }
  assert.equal(s.daily.archive('ta').total,5);
  assert.equal(s.app.server.listening,false);
 }finally{await s.close();}
});

test('administrator review and manual publication enforce four completed lists',async()=>{
 const s=await setup();try{
  const day=s.daily.reserve();
  assert.equal(s.daily.reviewSet(day.id,'ta',entries('ta',19),1).ready,false);
  assert.equal(s.daily.publish(day.id),false);
  for(const lang of LANG_CODES)assert.equal(s.daily.reviewSet(day.id,lang,entries(lang,20),1).ready,true);
  assert.equal(s.daily.publish(day.id),true);
  assert.throws(()=>s.daily.reviewSet(day.id,'ta',entries('ta',20),1),/immutable/);
  assert.equal(s.daily.today('ta').words[0].aiAssisted,false);
 }finally{await s.close();}
});

test('future overrides are shared; committed content is fixed; invalid dates and languages are rejected',async()=>{
 const s=await setup();try{
  s.daily.reserveDue();const id=s.daily.override({date:'2026-03-08',title:'Braiding hair before school',goal:'Explain a morning haircare routine'});
  assert.equal(s.db.get('SELECT title FROM daily_topic_dates WHERE id=?',id).title,'Braiding hair before school');
  assert.throws(()=>s.daily.reserve('2026-02-30'),/valid/);
  assert.throws(()=>s.daily.today('hi'),/Unknown language/);
  assert.throws(()=>s.daily.override({date:'2026-03-07',title:'Cannot replace today'}),/future/);
 }finally{await s.close();}
});

test('low catalog capacity plans a screened narrow extension and reserves it in the rolling backlog',async()=>{
 const ai={configured:true,model:'planner-fixture',async completeJSON({system}){
  if(system.startsWith('Screen'))return {approved:[0]};
  return {topics:[{title:'Protecting bamboo makeup brushes during humid travel',category:'Beauty',goal:'Explain packing, protecting, and drying a brush kit on a monsoon journey.',subthemes:['travel storage','drying techniques','brush hygiene']}]};
 }};
 const s=await setup({ai});try{
  s.db.run('DELETE FROM daily_microtopics WHERE id NOT IN (SELECT microtopic_id FROM daily_topic_dates)');
  s.clock.set('2026-03-08T05:00:00Z');
  await s.daily.tick({maxJobs:0});
  const newDate=s.db.get("SELECT * FROM daily_topic_dates WHERE topic_date='2026-03-15'");
  assert.match(newDate.title,/humid travel/);
  assert.equal(s.db.get("SELECT COUNT(*) n FROM daily_microtopics WHERE source='local-ai-planned'").n,1);
  assert.equal(s.daily.reserve('2026-03-07').title,'Makeup tools — names and descriptions');
 }finally{await s.close();}
});

test('pinned timezone survives DST, host configuration changes and midnight',async()=>{
 const s=await setup({instant:'2026-03-06T16:59:59Z'});try{
  assert.equal(s.daily.dateOf(),'2026-03-06');s.clock.set('2026-03-06T17:00:00Z');assert.equal(s.daily.dateOf(),'2026-03-07');
  s.clock.set('2026-11-01T06:30:00Z');assert.equal(s.daily.dateOf(),'2026-11-01');
  assert.equal(s.db.get("SELECT value FROM daily_curriculum_state WHERE key='timezone'").value,'Asia/Bangkok');
 }finally{await s.close();}
});

test('without Ollama, lists are built from the library and offline dictionary, reviewed by source evidence, and published',async()=>{
 const glossIndex=new Map();
 const nativeFor=(lang,gloss)=>{if(!glossIndex.has(gloss))glossIndex.set(gloss,glossIndex.size+1);const [root,letter]=roots[lang];return root+letter.repeat(glossIndex.get(gloss));};
 const dictionary={
  async health(){return {ok:true};},
  async lookupEnglish(gloss,lang){return {candidates:[
    {native:nativeFor(lang,gloss),english:gloss,basis:'Wiktionary translation table',score:80,pos:'noun'},
    {native:nativeFor(lang,gloss+'?'),english:'something unrelated',basis:'Wiktionary translation table',score:90,pos:'noun'}]};},
 };
 const s=await setup({ai:{configured:false,provider:'none'},dictionary});
 try{
  const r=await s.daily.tick({maxJobs:4});
  assert.equal(r.failed,0,JSON.stringify(s.daily.status({admin:true}).jobs.map(j=>j.error_summary)));
  const day=s.db.get("SELECT * FROM daily_topic_dates WHERE status='published' ORDER BY topic_date LIMIT 1");
  assert.ok(day,'a date is published without any model');
  for(const lang of LANG_CODES){
   const set=s.db.get('SELECT * FROM daily_topic_language_sets WHERE date_id=? AND language_code=?',day.id,lang);
   const entries=s.db.all('SELECT payload FROM daily_study_entries WHERE language_set_id=?',set.id).map(x=>JSON.parse(x.payload));
   assert.ok(entries.length>=10,`${lang} has ${entries.length} entries`);
   assert.ok(entries.every(e=>e.provenance.review.ok===true&&e.provenance.review.method==='source-evidence'));
   // the unrelated higher-scored sense is never chosen: the gloss must match the dictionary meaning
   assert.ok(entries.every(e=>e.source!=='offline-dictionary'||e.provenance.dictionaryEvidence[0].meanings[0]===e.english));
  }
  assert.ok(s.db.get("SELECT COUNT(*) n FROM vocabulary WHERE origin='daily-topic-dictionary'").n>0);
  assert.equal(s.db.get("SELECT COUNT(*) n FROM vocabulary WHERE origin='daily-topic-ai'").n,0);
 }finally{await s.close();}
});

test('offline validation: 10+ sourced entries, no phrase requirement, common words may recur',()=>{
 const list=entries('ta',12).map((e,i)=>({...e,construction:'word',native:roots.ta[0]+roots.ta[1].repeat(i+1),lemma:roots.ta[0]+roots.ta[1].repeat(i+1)}));
 assert.equal(validateDailyEntries(list,'ta').ok,false);
 assert.equal(validateDailyEntries(list,'ta',new Set(),{offline:true}).ok,true);
 assert.equal(validateDailyEntries(list.slice(0,9),'ta',new Set(),{offline:true}).ok,false);
 const history=new Set(list.slice(0,5).map(e=>lexicalIdentity(e.native)));
 assert.equal(validateDailyEntries(list,'ta',history,{offline:true}).ok,true);
 assert.equal(validateDailyEntries(list,'ta',history).ok,false);
});
