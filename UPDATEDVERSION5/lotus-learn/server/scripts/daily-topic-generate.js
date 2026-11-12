// Headless durable queue runner: intentionally does not listen on a browser port.
import { loadEnvFile } from '../config.js';
loadEnvFile();
const { createApp } = await import('../app.js');
const { seed } = await import('../seed/seed.js');
const app=createApp({automationEnabled:false});
try {
  await seed(app,{demoUsers:false});
  const daily=app.services.dailyTopics;
  daily.reserveDue();
  if(!process.argv.includes('--status')) {
    // Bounded run; rerun to drain long outages. Permanent state survives process exit.
    for(let batch=0;batch<31;batch++) {
      const result=await daily.tick({maxJobs:4});
      console.log(JSON.stringify(result));
      if(!result.completed||result.failed||!result.queued)break;
    }
  }
  const status=daily.status({admin:true});
  console.log(JSON.stringify(status,null,2));
  if(status.queued&&!process.argv.includes('--status'))process.exitCode=2;
} finally {await app.close();}
