'use strict';
const crypto = require('node:crypto');
const { db } = require('./db');

// تجزئة كلمات المرور بـ scrypt + ملح عشوائي لكل مستخدم — لا تُحفظ كنص مكشوف أبداً
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const [, salt, hash] = String(stored).split(':');
    const calc = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(calc, Buffer.from(hash, 'hex'));
  } catch { return false; }
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function newToken(bytes = 32) { return crypto.randomBytes(bytes).toString('hex'); }

const SESSION_TTL = 7 * 24 * 3600 * 1000;
function createSession(userId) {
  const token = newToken(32);
  const csrf = newToken(16);
  db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at,created_at) VALUES(?,?,?,?,?)')
    .run(hashToken(token), userId, csrf, Date.now() + SESSION_TTL, Date.now());
  return { token, csrf };
}
function getSession(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)pd_session=([a-f0-9]+)/);
  if (!m) return null;
  const row = db.prepare(`SELECT s.*, u.id AS uid, u.role, u.name, u.phone, u.status AS ustatus
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(hashToken(m[1]));
  if (!row || row.expires_at < Date.now()) return null;
  return { userId: row.uid, role: row.role, name: row.name, phone: row.phone, status: row.ustatus, csrf: row.csrf, token: m[1] };
}
function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

// رموز مصادقة من 6 أرقام (تأكيد البريد / استعادة كلمة المرور) — تُحفظ مجزّأة بملح عشوائي لكل رمز، صالحة 15 دقيقة، 5 محاولات كحد أقصى
function createAuthCode(userId, purpose) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const salt = newToken(8);
  db.prepare('DELETE FROM auth_codes WHERE user_id = ? AND purpose = ?').run(userId, purpose);
  db.prepare('INSERT INTO auth_codes(user_id,purpose,code_hash,expires_at,attempts,created_at) VALUES(?,?,?,?,0,?)')
    .run(userId, purpose, salt + ':' + hashToken(salt + ':' + purpose + ':' + code), Date.now() + 15 * 60e3, Date.now());
  return code;
}
function verifyAuthCode(userId, purpose, code) {
  const row = db.prepare('SELECT * FROM auth_codes WHERE user_id = ? AND purpose = ? ORDER BY id DESC LIMIT 1').get(userId, purpose);
  if (!row) return { ok: false, error: 'لا يوجد رمز صالح — اطلب رمزاً جديداً' };
  if (row.expires_at < Date.now()) return { ok: false, error: 'انتهت صلاحية الرمز — اطلب رمزاً جديداً' };
  if (row.attempts >= 5) return { ok: false, error: 'تجاوزت عدد المحاولات المسموح — اطلب رمزاً جديداً' };
  const parts = String(row.code_hash).split(':');
  const expected = parts.length === 2 ? hashToken(parts[0] + ':' + purpose + ':' + String(code || '').trim()) : hashToken(purpose + ':' + String(code || '').trim());
  const calc = Buffer.from(expected, 'hex');
  const stored = Buffer.from(parts.length === 2 ? parts[1] : parts[0], 'hex');
  const match = calc.length === stored.length && crypto.timingSafeEqual(calc, stored);
  if (!match) {
    db.prepare('UPDATE auth_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return { ok: false, error: 'الرمز غير صحيح' };
  }
  db.prepare('DELETE FROM auth_codes WHERE id = ?').run(row.id);
  return { ok: true };
}
function lastAuthCodeAt(userId, purpose) {
  const row = db.prepare('SELECT created_at FROM auth_codes WHERE user_id = ? AND purpose = ? ORDER BY id DESC LIMIT 1').get(userId, purpose);
  return row ? row.created_at : 0;
}

// حدّ محاولات الدخول: 5 محاولات فاشلة = قفل 15 دقيقة (يُخزَّن في حساب المستخدم نفسه)
const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;
function loginLocked(user) { return user.locked_until && user.locked_until > Date.now(); }
function registerLoginFail(user) {
  const fails = (user.failed_logins || 0) + 1;
  const locked = fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0;
  db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
    .run(fails >= MAX_FAILS ? 0 : fails, locked, user.id);
  return locked > 0;
}
function registerLoginSuccess(user) {
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?').run(user.id);
}

// حدّ عام بسيط في الذاكرة ضد الإغراق (طلبات حساسة)
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || { count: 0, start: now };
  if (now - b.start > windowMs) { b.count = 0; b.start = now; }
  b.count += 1; buckets.set(key, b);
  return b.count <= max;
}

function strongPassword(p) {
  return typeof p === 'string' && p.length >= 8 && p.length <= 128;
}
function validPhone(p) {
  return typeof p === 'string' && /^[0-9+\s]{9,16}$/.test(p.trim());
}
function cleanPhone(p) { return String(p || '').replace(/[\s-]/g, ''); }

module.exports = {
  hashPassword, verifyPassword, hashToken, newToken,
  createSession, getSession, destroySession,
  loginLocked, registerLoginFail, registerLoginSuccess,
  rateLimit, strongPassword, validPhone, cleanPhone,
  createAuthCode, verifyAuthCode, lastAuthCodeAt
};
