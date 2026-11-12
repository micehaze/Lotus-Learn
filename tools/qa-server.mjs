// Isolated browser test instance: no writes to the learner's database.
import { loadEnvFile } from '../server/config.js';
import { createApp } from '../server/app.js';
import { seed } from '../server/seed/seed.js';
loadEnvFile();
const app = createApp({ databaseFile: ':memory:', automationEnabled: false, testMode: true });
await seed(app, { demoUsers: true });
app.server.listen(3999, '127.0.0.1', () => console.log('Isolated browser QA: http://127.0.0.1:3999'));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await app.close(); process.exit(0); });
