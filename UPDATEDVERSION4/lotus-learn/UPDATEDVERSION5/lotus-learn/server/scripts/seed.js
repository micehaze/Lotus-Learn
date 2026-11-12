import { loadEnvFile } from '../config.js';
loadEnvFile();
const { createApp } = await import('../app.js');
const { seed } = await import('../seed/seed.js');
const app = createApp({ automationEnabled: false });
await seed(app, { demoUsers: app.config.seedDemoUser, log: console.log });
app.db.close();
