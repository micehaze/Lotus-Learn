// Usage: node server/scripts/create-admin.js you@example.com "a-strong-password" ["Display name"]
import { loadEnvFile } from '../config.js';
import { seed } from '../seed/seed.js';

loadEnvFile();
const { createApp } = await import('../app.js');
const [email, password, name = 'Administrator'] = process.argv.slice(2);
if (!email || !password) {
  console.error('Usage: node server/scripts/create-admin.js <email> <password> [name]');
  process.exit(1);
}

const app = createApp({ automationEnabled: false, dailyTopicEnabled: false });
try {
  if (!app.db.get('SELECT 1 FROM levels LIMIT 1')) await seed(app, { demoUsers: false });
  const existing = app.db.get('SELECT id FROM users WHERE email = ?', email.trim().toLowerCase());
  const id = existing ? existing.id : await app.services.auth.register({ email, password, displayName: name });
  app.db.run("UPDATE users SET role = 'admin' WHERE id = ?", id);
  app.services.profile.update(id, { onboarded: true });
  console.log(`${email.trim()} is now an administrator.`);
} finally {
  await app.close();
}
