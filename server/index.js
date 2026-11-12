// Lotus Learn server entry point.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Lotus Learn needs Node.js 22.13 or newer (built-in SQLite). You have ${process.versions.node}.`);
  process.exit(1);
}
const { loadEnvFile } = await import('./config.js');
loadEnvFile();
const { createApp } = await import('./app.js');
const { seed } = await import('./seed/seed.js');

const app = createApp();
// The seed is idempotent and also upgrades existing databases (new languages, grammar, longer stories).
await seed(app, { demoUsers: app.config.seedDemoUser, log: console.log });
app.server.listen(app.config.port, app.config.host, () => {
  console.log(`\n  🪷  Lotus Learn is running at http://localhost:${app.config.port}\n`);
  console.log(`  AI provider: ${app.services.content.automationStatus().ai.configured ? app.services.content.automationStatus().ai.provider : 'not configured (core learning works without it)'}`);
  console.log(`  YouTube discovery: ${app.services.content.automationStatus().youtube.configured ? 'configured' : 'not configured'}`);
  app.startScheduler();
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await app.close(); process.exit(0); });
