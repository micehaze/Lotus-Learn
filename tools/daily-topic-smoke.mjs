// Explicit local-model integration trial against a disposable database, never the user's data.
import fs from 'node:fs';
import path from 'node:path';
import {loadEnvFile,ROOT} from '../server/config.js';
loadEnvFile();
import {createAI} from '../server/integrations/index.js';
import {LANG_CODES,LANGUAGES,validateNative} from '../shared/indic.js';
const {createApp}=await import('../server/app.js');
const {seed}=await import('../server/seed/seed.js');
const dir=path.join(ROOT,'verification');fs.mkdirSync(dir,{recursive:true});
if(process.argv.includes('--probe')){
 const ai=createAI({ai:{provider:'ollama',ollamaUrl:process.env.OLLAMA_URL,ollamaModel:'qwen3:4b',timeoutMs:180000}});
 const properties=Object.fromEntries(LANG_CODES.map(l=>[l,{type:'string'}]));
 try{
   const entries=await ai.completeJSON({system:'Return short native-script expressions in the specified languages.',prompt:`Give a natural translation of "wash your hands" in ${LANG_CODES.map(l=>LANGUAGES[l].name).join(', ')}. One short expression for each JSON key.`,schema:{type:'object',properties,required:LANG_CODES},maxTokens:250,contextTokens:2048,temperature:0});
   const results=LANG_CODES.map(lang=>({lang,expression:entries[lang],scriptValid:typeof entries[lang]==='string'&&!validateNative(entries[lang],lang,{minRatio:1}).length}));
   console.log(JSON.stringify({model:ai.model,results,note:'Script checks only; not native-language verification.'},null,2));
   process.exitCode=results.every(r=>r.scriptValid)?0:2;
 }catch(e){console.error(e.message);process.exitCode=2;}
}else{
const file=path.join(dir,`daily-topic-smoke-${Date.now()}.db`);
const app=createApp({databaseFile:file,testMode:true,automationEnabled:false,dailyTopicEnabled:false,dailyTopicTarget:20,dailyTopicAi:{provider:'ollama',ollamaModel:'qwen3:4b',timeoutMs:Number(process.env.DAILY_TOPIC_SMOKE_TIMEOUT_MS)||300000}});
try{
 await seed(app,{demoUsers:false});
 const health=await app.services.providers.health();
 console.log(JSON.stringify({database:file,model:'qwen3:4b',dictionaryAvailable:!!health.ok,startedAt:new Date().toISOString()}));
 for(let i=0;i<4;i++){
   const report=await app.services.dailyTopics.tick({maxJobs:1});
   console.log(JSON.stringify({stage:i+1,report,sets:app.db.all('SELECT language_code,status,word_count FROM daily_topic_language_sets WHERE date_id=(SELECT MIN(id) FROM daily_topic_dates)')}));
 }
 const result={model:'qwen3:4b',database:file,status:app.services.dailyTopics.status({admin:true}),day:app.services.dailyTopics.inspect(1),finishedAt:new Date().toISOString(),note:'Real model output is AI-reviewed, not native-speaker verified. No production database was changed.'};
 const resultPath=file.replace(/\.db$/u,'.json');
 fs.writeFileSync(resultPath,JSON.stringify(result,null,2));
 console.log(JSON.stringify({resultPath,summary:result.status,sets:result.day.languages.map(s=>({lang:s.language_code,count:s.word_count,status:s.status}))}));
 if(result.day.status!=='published')process.exitCode=2;
}finally{await app.close();}
}
