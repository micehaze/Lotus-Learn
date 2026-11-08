import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError, bad, conflict, sha256, randomToken } from '../util.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SESSION_COOKIE = 'lotus_session';
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(password, stored) {
  const [alg, n, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = Buffer.from(keyB64, 'base64');
  const test = await scrypt(password, Buffer.from(saltB64, 'base64'), key.length, { ...SCRYPT, N: Number(n) });
  return crypto.timingSafeEqual(key, test);
}

export function validateCredentials({ email, password }) {
  const e = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw bad('Please enter a valid email address.');
  const p = String(password || '');
  if (p.length < 8) throw bad('Password must be at least 8 characters.');
  if (p.length > 200) throw bad('Password is too long.');
  return { email: e, password: p };
}

export function createAuthService({ db, clock, config, mailer }) {
  const nowIso = () => clock.now().toISOString();

  async function register({ email, password, displayName }) {
    const c = validateCredentials({ email, password });
    const name = String(displayName || '').trim().slice(0, 60) || c.email.split('@')[0];
    if (db.get('SELECT id FROM users WHERE email = ?', c.email)) throw conflict('An account with this email already exists.');
    const hash = await hashPassword(c.password);
    const role = config.adminEmail && c.email === config.adminEmail ? 'admin' : 'learner';
    return db.tx(() => {
      const now = nowIso();
      const r = db.run('INSERT INTO users(email, password_hash, role, created_at) VALUES (?,?,?,?)', c.email, hash, role, now);
      const userId = Number(r.lastInsertRowid);
      db.run('INSERT INTO user_profiles(user_id, display_name, updated_at) VALUES (?,?,?)', userId, name, now);
      return userId;
    });
  }

  async function login({ email, password }) {
    const e = String(email || '').trim().toLowerCase();
    const user = db.get('SELECT * FROM users WHERE email = ?', e);
    // constant-ish work even when the user does not exist
    const ok = user ? await verifyPassword(String(password || ''), user.password_hash) : (await hashPassword('x'), false);
    if (!ok) throw new HttpError(401, 'Incorrect email or password.');
    return user.id;
  }

  function createSession(userId, userAgent = '') {
    const token = randomToken();
    const now = clock.now();
    const expires = new Date(now.getTime() + config.sessionDays * 86400_000);
    db.run('INSERT INTO auth_sessions(id, user_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)',
      sha256(token), userId, now.toISOString(), expires.toISOString(), String(userAgent).slice(0, 200));
    return { token, expires };
  }

  function sessionCookie(token, expires) {
    const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
    if (expires) parts.push(`Expires=${expires.toUTCString()}`); else parts.push('Max-Age=0');
    if (config.secureCookies) parts.push('Secure');
    return parts.join('; ');
  }

  function userFromToken(token) {
    if (!token) return null;
    const row = db.get(`SELECT u.id, u.email, u.role, u.created_at, s.expires_at FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`, sha256(token));
    if (!row) return null;
    if (row.expires_at <= nowIso()) { db.run('DELETE FROM auth_sessions WHERE id = ?', sha256(token)); return null; }
    return { id: row.id, email: row.email, role: row.role, createdAt: row.created_at };
  }

  function destroySession(token) {
    if (token) db.run('DELETE FROM auth_sessions WHERE id = ?', sha256(token));
  }

  async function requestPasswordReset(email) {
    const e = String(email || '').trim().toLowerCase();
    const user = db.get('SELECT id, email FROM users WHERE email = ?', e);
    if (!user) return; // never reveal whether an account exists
    const token = randomToken();
    const expires = new Date(clock.now().getTime() + 3600_000).toISOString();
    db.run('INSERT INTO password_resets(token_hash, user_id, expires_at) VALUES (?,?,?)', sha256(token), user.id, expires);
    const link = `${config.publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await mailer.send({
      to: user.email,
      subject: 'Reset your Lotus Learn password',
      text: `Someone asked to reset the password for this Lotus Learn account.\n\nOpen this link within one hour to choose a new password:\n${link}\n\nIf this was not you, ignore this email.`,
    });
  }

  async function resetPassword({ token, password }) {
    const p = validateCredentials({ email: 'x@example.com', password }).password;
    const row = db.get('SELECT * FROM password_resets WHERE token_hash = ?', sha256(String(token || '')));
    if (!row || row.used_at || row.expires_at <= nowIso()) throw bad('This reset link is invalid or has expired.');
    const hash = await hashPassword(p);
    db.tx(() => {
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, row.user_id);
      db.run('UPDATE password_resets SET used_at = ? WHERE token_hash = ?', nowIso(), row.token_hash);
      db.run('DELETE FROM auth_sessions WHERE user_id = ?', row.user_id); // sign out everywhere
    });
  }

  async function changePassword(userId, { current, next }) {
    const user = db.get('SELECT password_hash FROM users WHERE id = ?', userId);
    if (!(await verifyPassword(String(current || ''), user.password_hash))) throw bad('Your current password is incorrect.');
    const p = validateCredentials({ email: 'x@example.com', password: next }).password;
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(p), userId);
  }

  async function deleteAccount(userId, password) {
    const user = db.get('SELECT password_hash FROM users WHERE id = ?', userId);
    if (!(await verifyPassword(String(password || ''), user.password_hash))) throw bad('Password is incorrect.');
    db.run('DELETE FROM users WHERE id = ?', userId); // cascades to all personal data
  }

  return { register, login, createSession, sessionCookie, userFromToken, destroySession, requestPasswordReset, resetPassword, changePassword, deleteAccount };
}
