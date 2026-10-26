'use strict';
// خادم منصة SOUQAR — Node.js مدمج فقط، بلا اعتماديات خارجية
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
// تحميل أسرار الخادم من ملف .env المحلي (مهمل في Git) — لا أسرار داخل الكود أبداً
try {
  const envFile = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  }
} catch {}
const { db, DATA_DIR, audit } = require('./db');
// نسخة البناء: الواجهة تقارنها دورياً وتعيد التحميل تلقائياً عند أي تحديث — حتى لا يبقى أي هاتف عالقاً على بناء قديم
const BUILD_VERSION = 'v2026.10.26-17';
const sec = require('./security');
const integ = require('./integrations');
const { iconPNG } = require('./icon');
const splashBg = require('./splash-bg-data');
const heroBg = require('./hero-bg-data');
const pimgData = require('./pimg-data');
const SPLASH_BUF = Buffer.from(splashBg.base64, 'base64');
const HERO_BUF = Buffer.from(heroBg.base64, 'base64');
const PIMG_BUF = Buffer.from(pimgData.base64, 'base64');

const PORT = Number(process.env.PORT || 4173);
const PUBLIC = path.join(__dirname, '..', 'public');
const UPLOADS = path.join(DATA_DIR, 'uploads');

const ORDER_STATUSES = {
  pending_supplier: 'طلب جديد — بانتظار تأكيد المورد',
  confirmed: 'مؤكد',
  preparing: 'قيد التجهيز',
  handed: 'سُلّم لشركة التوصيل',
  out_for_delivery: 'خرج للتوصيل',
  delivered_collected: 'تم التسليم والتحصيل',
  cancelled: 'أُلغي',
  rejected: 'مرفوض من المورد',
  failed_delivery: 'تعذر التسليم',
  returned: 'مرتجع'
};
const TRANSITIONS = {
  pending_supplier: ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['handed', 'cancelled'],
  handed: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered_collected', 'failed_delivery'],
  failed_delivery: ['out_for_delivery', 'returned'],
  delivered_collected: ['returned'], cancelled: [], rejected: [], returned: []
};

function send(res, code, obj, headers = {}) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': typeof obj === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', ...headers });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 10 * 1024 * 1024) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('bad_json')); }
    });
    req.on('error', reject);
  });
}
function sessionOf(req) { return sec.getSession(req); }
function requireAuth(req, res, roles) {
  const s = sessionOf(req);
  if (!s) { send(res, 401, { error: 'يجب تسجيل الدخول أولاً' }); return null; }
  if (s.status !== 'active') { send(res, 403, { error: 'الحساب غير مفعّل بعد أو موقوف' }); return null; }
  if (roles && !roles.includes(s.role)) { send(res, 403, { error: 'صلاحيات غير كافية لهذا الإجراء' }); return null; }
  // حماية CSRF للطلبات المعدِّلة عند وجود جلسة
  if (req.method !== 'GET' && req.headers['x-csrf'] !== s.csrf) {
    send(res, 403, { error: 'رمز حماية الجلسة غير صالح — حدّث الصفحة وحاول مجدداً' }); return null;
  }
  return s;
}
function publicUser(u) {
  if (!u) return null;
  const { password_hash, failed_logins, locked_until, ...rest } = u;
  return rest;
}
function getUser(id) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id); }
function customerPrice(p) { return p.wholesale_price + p.platform_margin; }
const PAY_METHODS = ['تحويل بريدي موب', 'تحويل البريد الجاري', 'التحصيل من مقر المنصة', 'Enveloppe', 'Flexy', 'نقداً عند الاستلام من الإدارة'];
function communesOf(w) {
  try {
    if (!globalThis.__communes) globalThis.__communes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'communes.json'), 'utf8'));
    return globalThis.__communes[String(w)] || [];
  } catch { return []; }
}
function validCommune(w, name) {
  if (!name) return true;
  return communesOf(w).some((c) => c.ar === name || c.fr === name);
}

async function notifyAdmin(text) {
  const chat = integ.adminChatId();
  if (chat) await integ.notify({ channel: 'telegram', type: 'admin_alert', text, target: chat });
}
function orderDigest(o, forSupplier) {
  const items = db.prepare('SELECT oi.qty, p.name FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?').all(o.id);
  const buyerAcc = o.buyer_id ? db.prepare('SELECT name, phone FROM users WHERE id = ?').get(o.buyer_id) : null;
  const bName = o.guest_name || (buyerAcc && buyerAcc.name) || '—';
  const bPhone = o.guest_phone || (buyerAcc && buyerAcc.phone) || '—';
  const wRow = db.prepare('SELECT name_ar FROM wilayas WHERE code = ?').get(o.wilaya);
  const wName = wRow ? wRow.name_ar : ('ولاية ' + o.wilaya);
  const sup = db.prepare('SELECT name, business_name FROM users WHERE id = ?').get(o.supplier_id);
  const lines = [
    '🛒 طلب جديد في منصة SOUQAR: ' + o.ref,
    'المنتج: ' + items.map((i) => i.name + ' ×' + i.qty).join('، '),
    'المشتري: ' + bName + ' — ' + bPhone,
    'العنوان: ' + wName + (o.commune ? ' — ' + o.commune : '') + (o.address ? ' — ' + o.address : ''),
    'الإجمالي: ' + o.total + ' دج (منتجات ' + o.subtotal + ' دج + توصيل ' + o.delivery_fee + ' دج)'
  ];
  if (!forSupplier) {
    if (o.marketer_id) {
      const mk = db.prepare('SELECT name, phone FROM users WHERE id = ?').get(o.marketer_id);
      const cm = db.prepare('SELECT amount FROM commissions WHERE order_id = ?').get(o.id);
      lines.push('المسوّق: ' + (mk ? mk.name : '#' + o.marketer_id) + (mk && mk.phone ? ' (' + mk.phone + ')' : '') + ' — عمولته: ' + (cm ? cm.amount : 0) + ' دج');
    } else lines.push('المسوّق: طلب مباشر (بلا مسوّق)');
    lines.push('المورّد: ' + (sup ? (sup.business_name || sup.name) : '—'));
  }
  return lines.join('\n');
}
// إشعارات حدث طلب — نصّ لكل دور بما يخصّه فقط (تدقيق 2026-10-25: كان نص المورد يصل للمسوق، والمشتري لا يُشعَر أبداً)
async function notifyOrderEvent(order, kind, statusLabel) {
  const supText = kind === 'created'
    ? orderDigest(order, true) + '\nبانتظار تأكيدك في لوحة المورد — SOUQAR'
    : `تغيّرت حالة الطلب ${order.ref} إلى: ${statusLabel}`;
  await integ.notify({ userId: order.supplier_id, channel: 'telegram', type: 'order_update', text: supText });
  await integ.notify({ userId: order.supplier_id, channel: 'log', type: 'order_update', text: supText });
  if (order.marketer_id) {
    const cm = db.prepare('SELECT amount FROM commissions WHERE order_id = ?').get(order.id);
    const mkText = kind === 'created'
      ? `🧾 طلب جديد من زبونك في SOUQAR: ${order.ref} — بانتظار تأكيد المورد. عمولتك المتوقعة: ${cm ? cm.amount : 0} دج — تابع حالته من لوحتك.`
      : `تغيّرت حالة طلب زبونك ${order.ref} إلى: ${statusLabel}`;
    await integ.notify({ userId: order.marketer_id, channel: 'log', type: 'order_update', text: mkText });
  }
  if (order.buyer_id) {
    const byText = kind === 'created'
      ? `🧾 استلمنا طلبك ${order.ref} في SOUQAR — بانتظار تأكيد المورد. تتبّع حالته من حسابك أو صفحة «تتبع طلبك».`
      : `📦 تحديث طلبك ${order.ref}: ${statusLabel} — SOUQAR`;
    await integ.notify({ userId: order.buyer_id, channel: 'log', type: 'order_update', text: byText });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    // ---------- الإعداد الأولي (أول مدير فقط) ----------
    if (p === '/api/setup/status' && req.method === 'GET') {
      const c = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c;
      return send(res, 200, { needsSetup: c === 0 });
    }
    // إعدادات عامة للواجهة — تسجيل الموردين يُغلق/يُفتح من الإدارة (مغلق الآن بأمر المؤسس حتى الحاجة)
    const suppliersOpen = () => { const r = db.prepare("SELECT value FROM settings WHERE key = 'suppliers_open'").get(); return !r || r.value !== '0'; };
    if (p === '/api/config' && req.method === 'GET') {
      return send(res, 200, { suppliersOpen: suppliersOpen(), version: BUILD_VERSION });
    }
    if (p === '/api/setup' && req.method === 'POST') {
      const c = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c;
      if (c > 0) return send(res, 403, { error: 'تم إنشاء حساب المدير مسبقاً' });
      const b = await readBody(req);
      if (!b.name || !sec.validPhone(b.phone || '') || !sec.strongPassword(b.password || ''))
        return send(res, 400, { error: 'أدخل الاسم ورقم هاتف صحيح وكلمة مرور من 8 أحرف على الأقل' });
      const info = db.prepare(`INSERT INTO users(role,name,phone,email,password_hash,status,created_at)
        VALUES('admin',?,?,?,?, 'active',?)`).run(b.name.trim(), sec.cleanPhone(b.phone), b.email || null, sec.hashPassword(b.password), Date.now());
      audit(Number(info.lastInsertRowid), 'setup_admin', 'user', info.lastInsertRowid, null);
      return send(res, 201, { ok: true });
    }

    // ---------- المصادقة ----------
    if (p === '/api/auth/register' && req.method === 'POST') {
      if (!sec.rateLimit('reg:' + req.socket.remoteAddress, 20, 3600e3)) return send(res, 429, { error: 'محاولات كثيرة — حاول لاحقاً' });
      const b = await readBody(req);
      const role = b.role;
      if (!['supplier', 'marketer', 'buyer'].includes(role)) return send(res, 400, { error: 'اختر نوع الحساب: مورد أو مسوق أو مشتري' });
      if (role === 'supplier' && !suppliersOpen()) return send(res, 403, { error: 'تسجيل الموردين مغلق مؤقتاً — سيُفتح لاحقاً' });
      if (!b.name || !String(b.name).trim()) return send(res, 400, { error: 'الاسم مطلوب' });
      if (!sec.validPhone(b.phone || '')) return send(res, 400, { error: 'رقم هاتف غير صحيح' });
      if (!sec.strongPassword(b.password || '')) return send(res, 400, { error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
      if (b.password !== b.passwordConfirm) return send(res, 400, { error: 'تأكيد كلمة المرور غير مطابق' });
      if (b.terms !== true) return send(res, 400, { error: 'يجب الموافقة على الشروط للمتابعة' });
      if (role === 'supplier' && !b.activity) return send(res, 400, { error: 'معلومات النشاط مطلوبة للمورد' });
      const email = b.email ? String(b.email).trim().toLowerCase() : null;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return send(res, 400, { error: 'بريد إلكتروني غير صحيح' });
      if (email && db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return send(res, 409, { error: 'يوجد حساب مسجل بهذا البريد — سجّل الدخول' });
      const phone = sec.cleanPhone(b.phone);
      if (db.prepare('SELECT id FROM users WHERE phone = ?').get(phone)) return send(res, 409, { error: 'يوجد حساب مسجل بهذا الرقم — سجّل الدخول' });
      const status = role === 'supplier' ? 'pending' : 'active';
      let invitedBy = null;
      if (b.inviteCode) {
        const inv = db.prepare('SELECT id FROM users WHERE invite_code = ?').get(String(b.inviteCode).trim());
        if (inv) invitedBy = inv.id;
      }
      const info = db.prepare(`INSERT INTO users(role,name,phone,email,email_verified,password_hash,wilaya,commune,address,business_name,activity,telegram_chat_id,status,invited_by,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(role, String(b.name).trim(), phone, email, 1, sec.hashPassword(b.password),
          b.wilaya ? Number(b.wilaya) : null, b.commune || null, b.address || null,
          b.businessName || null, b.activity || null, b.telegramChatId || null, status, invitedBy, Date.now());
      const id = Number(info.lastInsertRowid);
      audit(id, 'register', 'user', id, role);
      if (role === 'supplier') { await integ.notify({ channel: 'log', type: 'supplier_pending', text: `مورد جديد بانتظار المراجعة: ${b.name} (${phone})` }); await notifyAdmin(`🏭 مورد جديد بانتظار مراجعة الإدارة في منصة SOUQAR: ${b.name} (${phone})`); }
      return send(res, 201, { ok: true, status, message: role === 'supplier' ? 'تم إنشاء الحساب. حسابات الموردين تُراجَع من الإدارة قبل تفعيل النشر واستقبال الطلبات.' : 'تم إنشاء الحساب بنجاح — يمكنك تسجيل الدخول.' });
    }
    if (p === '/api/auth/login' && req.method === 'POST') {
      const b = await readBody(req);
      const phone = sec.cleanPhone(b.phone || '');
      const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
      if (!user) return send(res, 401, { error: 'بيانات الدخول غير صحيحة' });
      if (sec.loginLocked(user)) return send(res, 423, { error: 'الحساب مقفل مؤقتاً بسبب محاولات فاشلة — حاول بعد 15 دقيقة' });
      if (!sec.verifyPassword(b.password || '', user.password_hash)) {
        const locked = sec.registerLoginFail(user);
        return send(res, 401, { error: locked ? 'تم قفل الحساب 15 دقيقة بعد 5 محاولات فاشلة' : 'بيانات الدخول غير صحيحة' });
      }
      if (user.status === 'rejected') return send(res, 403, { error: 'تم رفض هذا الحساب من الإدارة' + (user.reject_reason ? ': ' + user.reject_reason : '') });
      if (user.status === 'suspended') return send(res, 403, { error: 'هذا الحساب موقوف — تواصل مع الدعم' });
      sec.registerLoginSuccess(user);
      const { token, csrf } = sec.createSession(user.id);
      audit(user.id, 'login', 'user', user.id, null);
      const secureFlag = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return send(res, 200, { ok: true, user: publicUser(user), csrf }, {
        'Set-Cookie': `pd_session=${token}; HttpOnly; SameSite=Lax${secureFlag}; Path=/; Max-Age=${7 * 24 * 3600}`
      });
    }
    if (p === '/api/auth/logout' && req.method === 'POST') {
      const s = sessionOf(req); if (s) sec.destroySession(s.token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'pd_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    }
    if (p === '/api/auth/forgot' && req.method === 'POST') {
      if (!sec.rateLimit('forgot:' + req.socket.remoteAddress, 10, 3600e3)) return send(res, 429, { error: 'طلبات كثيرة — حاول بعد قليل' });
      const b = await readBody(req);
      let user = null;
      if (b.email) user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(b.email).trim().toLowerCase());
      else if (b.phone) user = db.prepare('SELECT * FROM users WHERE phone = ?').get(sec.cleanPhone(b.phone));
      if (user && Date.now() - sec.lastAuthCodeAt(user.id, 'reset_password') > 60e3) {
        const token = sec.newToken(20);
        // يُخزَّن التجزئة فقط — النص الصريح لا يُكتب في القاعدة أبداً (تدقيق 2026-10-25)
        db.prepare('INSERT INTO password_resets(user_id,token,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)')
          .run(user.id, '', sec.hashToken(token), Date.now() + 30 * 60e3, Date.now());
        // سجل التطبيق لا يحمل أي سرّ — الرمز يصل عبر القنوات الخارجية المضبوطة فقط
        await integ.notify({ userId: user.id, channel: 'log', type: 'password_reset', text: '🔐 طُلبت استعادة كلمة مرور حسابك — أُرسل الرمز عبر قنواتك المضبوطة (تيليغرام/بريد/واتساب). إن لم تطلبها تجاهل هذه الرسالة.' });
        if (user.telegram_chat_id) await integ.notify({ userId: user.id, channel: 'telegram', type: 'password_reset', text: `SOUQAR — رمز استعادة كلمة المرور (30 دقيقة): ${token}` });
        // رمز قصير من 6 أرقام عبر القناة المطلوبة: البريد الإلكتروني أو الهاتف (تيليغرام/واتساب حسب المضبوط)
        const code = sec.createAuthCode(user.id, 'reset_password');
        const codeText = `رمز استعادة كلمة المرور في منصة SOUQAR هو: ${code}\nصالح لمدة 15 دقيقة. أدخله مع رقم هاتفك أو بريدك في نموذج الاستعادة.`;
        if (b.email && user.email) await integ.notify({ userId: user.id, channel: 'email', type: 'password_reset', target: user.email, text: codeText });
        else {
          if (user.telegram_chat_id) await integ.notify({ userId: user.id, channel: 'telegram', type: 'password_reset', text: codeText });
          await integ.notify({ userId: user.id, channel: 'whatsapp', type: 'password_reset', target: user.phone, text: codeText });
        }
      }
      return send(res, 200, { ok: true, message: 'إذا كان الحساب مسجلاً، وصلك رمز الاستعادة (6 أرقام) عبر القناة المختارة.' });
    }
    if (p === '/api/auth/reset' && req.method === 'POST') {
      const b = await readBody(req);
      if (!sec.strongPassword(b.password || '')) return send(res, 400, { error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
      if (b.password !== b.passwordConfirm) return send(res, 400, { error: 'تأكيد كلمة المرور غير مطابق' });
      // المسار الأول: رمز قصير من 6 أرقام + رقم الهاتف أو البريد
      if (b.code) {
        let user = null;
        if (b.email) user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(b.email).trim().toLowerCase());
        else if (b.phone) user = db.prepare('SELECT * FROM users WHERE phone = ?').get(sec.cleanPhone(b.phone));
        if (!user) return send(res, 400, { error: 'الحساب غير موجود' });
        const v = sec.verifyAuthCode(user.id, 'reset_password', b.code);
        if (!v.ok) return send(res, 400, { error: v.error });
        db.prepare('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = 0 WHERE id = ?').run(sec.hashPassword(b.password), user.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
        audit(user.id, 'password_reset_code', 'user', user.id, null);
        return send(res, 200, { ok: true, message: 'تم تغيير كلمة المرور — سجّل الدخول من جديد.' });
      }
      const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > ?')
        .get(sec.hashToken(String(b.token || '')), Date.now());
      if (!row) return send(res, 400, { error: 'الرمز غير صالح أو منتهي الصلاحية' });
      db.prepare('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = 0 WHERE id = ?').run(sec.hashPassword(b.password), row.user_id);
      db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(row.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
      return send(res, 200, { ok: true, message: 'تم تغيير كلمة المرور — سجّل الدخول من جديد.' });
    }
    if (p === '/api/me' && req.method === 'GET') {
      const s = sessionOf(req);
      if (!s) return send(res, 200, { user: null });
      return send(res, 200, { user: publicUser(getUser(s.userId)), csrf: s.csrf });
    }
    // تعديل بيانات الحساب من داخل اللوحة (الهاتف يبقى ثابتاً لأنه معرّف الدخول)
    if (p === '/api/me' && req.method === 'PATCH') {
      const s = requireAuth(req, res); if (!s) return;
      const me = getUser(s.userId);
      const b = await readBody(req);
      const name = b.name !== undefined ? String(b.name).trim() : me.name;
      if (!name) return send(res, 400, { error: 'الاسم مطلوب' });
      let email = me.email, emailChanged = false;
      if (b.email !== undefined) {
        const ne = b.email ? String(b.email).trim().toLowerCase() : null;
        if (ne && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(ne)) return send(res, 400, { error: 'بريد إلكتروني غير صحيح' });
        if (ne && ne !== me.email && db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(ne, me.id)) return send(res, 409, { error: 'هذا البريد مسجل لحساب آخر' });
        emailChanged = ne !== me.email;
        email = ne;
      }
      // تحقق صارم من القيم (تدقيق 2026-10-25): ولاية/بلدية/وسيلة دفع لا تُحفظ إلا صحيحة
      let wilaya = me.wilaya;
      if (b.wilaya !== undefined) {
        if (b.wilaya === '' || b.wilaya === null) wilaya = null;
        else { wilaya = Number(b.wilaya); if (!Number.isInteger(wilaya) || wilaya < 1 || wilaya > 58) return send(res, 400, { error: 'اختر ولاية صحيحة من القائمة' }); }
      }
      let commune = me.commune;
      if (b.commune !== undefined) commune = b.commune ? String(b.commune).trim() : null;
      if (commune && wilaya && !validCommune(wilaya, commune)) return send(res, 400, { error: 'البلدية لا تنتمي للولاية المختارة — اخترها من القائمة' });
      if (commune && !wilaya) return send(res, 400, { error: 'اختر الولاية أولاً ثم البلدية' });
      let payMethod = me.payment_method;
      if (b.paymentMethod !== undefined) {
        payMethod = b.paymentMethod ? String(b.paymentMethod).trim() : null;
        if (payMethod && !PAY_METHODS.includes(payMethod)) return send(res, 400, { error: 'اختر وسيلة استلام الأرباح من القائمة' });
      }
      let payDetails = me.payment_details;
      if (b.paymentDetails !== undefined) {
        payDetails = b.paymentDetails ? String(b.paymentDetails).trim().slice(0, 200) : null;
        if (payDetails && !payMethod) return send(res, 400, { error: 'اختر وسيلة الاستلام أولاً ثم اكتب تفاصيلها' });
      }
      let telegram = me.telegram_chat_id;
      if (b.telegramChatId !== undefined) {
        telegram = b.telegramChatId ? String(b.telegramChatId).trim() : null;
        if (telegram && !/^-?\d{5,15}$/.test(telegram)) return send(res, 400, { error: 'معرّف تيليغرام يجب أن يكون رقماً' });
      }
      db.prepare('UPDATE users SET name = ?, email = ?, email_verified = ?, wilaya = ?, commune = ?, address = ?, business_name = ?, telegram_chat_id = ?, payment_method = ?, payment_details = ? WHERE id = ?')
        .run(name, email, 1, wilaya, commune,
          b.address !== undefined ? (b.address ? String(b.address).trim().slice(0, 300) : null) : me.address,
          b.businessName !== undefined ? (b.businessName || null) : me.business_name,
          telegram, payMethod, payDetails, me.id);
      audit(me.id, 'profile_update', 'user', me.id, emailChanged ? 'email_changed' : null);
      return send(res, 200, { ok: true, user: publicUser(getUser(me.id)), message: 'تم حفظ بياناتك.' });
    }
    // تغيير كلمة المرور من داخل الحساب (بكلمة المرور الحالية)
    if (p === '/api/me/password' && req.method === 'POST') {
      const s = requireAuth(req, res); if (!s) return;
      const me = getUser(s.userId);
      const b = await readBody(req);
      if (!sec.verifyPassword(b.currentPassword || '', me.password_hash)) return send(res, 401, { error: 'كلمة المرور الحالية غير صحيحة' });
      if (!sec.strongPassword(b.password || '')) return send(res, 400, { error: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل' });
      if (b.password !== b.passwordConfirm) return send(res, 400, { error: 'تأكيد كلمة المرور غير مطابق' });
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(sec.hashPassword(b.password), me.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(me.id, sec.hashToken(s.token));
      audit(me.id, 'password_change', 'user', me.id, null);
      return send(res, 200, { ok: true, message: 'تم تغيير كلمة المرور — أُنهيت جلساتك الأخرى.' });
    }

    // ---------- بيانات عامة ----------
    if (p === '/api/wilayas' && req.method === 'GET') {
      return send(res, 200, { wilayas: db.prepare('SELECT * FROM wilayas ORDER BY code').all() });
    }
    if (p === '/api/categories' && req.method === 'GET') {
      return send(res, 200, { categories: db.prepare('SELECT * FROM categories ORDER BY name').all() });
    }
    if (p === '/api/products' && req.method === 'GET') {
      const q = (url.searchParams.get('search') || '').trim();
      const cat = url.searchParams.get('category');
      let sql = `SELECT p.*, c.name AS category_name, u.business_name, u.name AS supplier_name,
        (SELECT COALESCE(SUM(oi.qty),0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.status NOT IN ('cancelled','rejected','returned','failed_delivery')) AS sold,
        (SELECT AVG(stars) FROM product_reviews WHERE product_id = p.id) AS rating_avg,
        (SELECT COUNT(*) FROM product_reviews WHERE product_id = p.id) AS rating_count
        FROM products p LEFT JOIN categories c ON c.id = p.category_id JOIN users u ON u.id = p.supplier_id
        WHERE p.status = 'approved' AND u.status = 'active'`;
      const args = [];
      if (q) { sql += ' AND (p.name LIKE ? OR p.description LIKE ?)'; args.push('%' + q + '%', '%' + q + '%'); }
      if (cat) { sql += ' AND p.category_id = ?'; args.push(Number(cat)); }
      const sort = url.searchParams.get('sort');
      sql += sort === 'price_asc' ? ' ORDER BY (p.wholesale_price + p.platform_margin) ASC'
        : sort === 'price_desc' ? ' ORDER BY (p.wholesale_price + p.platform_margin) DESC'
        : sort === 'sold' ? ' ORDER BY sold DESC, p.id DESC'
        : sort === 'rating' ? ' ORDER BY (rating_avg IS NULL), rating_avg DESC, p.id DESC'
        : ' ORDER BY p.id DESC';
      const rows = db.prepare(sql).all(...args).map((r) => ({
        id: r.id, supplier_id: r.supplier_id, name: r.name, description: r.description, category_id: r.category_id, category_name: r.category_name,
        supplier_name: r.supplier_name, business_name: r.business_name, customer_price: customerPrice(r), compare_price: r.compare_price, stock: r.stock, sold: r.sold, rating_avg: r.rating_avg, rating_count: r.rating_count, created_at: r.created_at,
        sizes: JSON.parse(r.sizes), colors: JSON.parse(r.colors), images: JSON.parse(r.images),
        in_stock: r.stock > 0
      }));
      return send(res, 200, { products: rows });
    }
    const pm = p.match(/^\/api\/products\/(\d+)$/);
    if (pm && req.method === 'GET') {
      const r = db.prepare(`SELECT p.*, c.name AS category_name, u.business_name, u.name AS supplier_name FROM products p LEFT JOIN categories c ON c.id = p.category_id JOIN users u ON u.id = p.supplier_id WHERE p.id = ?`).get(Number(pm[1]));
      if (!r || r.status !== 'approved') return send(res, 404, { error: 'المنتج غير موجود أو غير متاح' });
      const coverage = db.prepare('SELECT wilaya_code, delivery_fee, fee_office, duration FROM supplier_coverage WHERE supplier_id = ? ORDER BY wilaya_code').all(r.supplier_id);
      const rating = db.prepare('SELECT AVG(stars) a, COUNT(*) c FROM product_reviews WHERE product_id = ?').get(r.id);
      const reviews = db.prepare('SELECT pr.stars, pr.comment, pr.created_at, u.name AS user_name FROM product_reviews pr JOIN users u ON u.id = pr.user_id WHERE pr.product_id = ? ORDER BY pr.id DESC LIMIT 20').all(r.id);
      return send(res, 200, { product: { id: r.id, supplier_id: r.supplier_id, supplier_name: r.supplier_name, business_name: r.business_name, name: r.name, description: r.description, category_id: r.category_id, category_name: r.category_name, customer_price: customerPrice(r), compare_price: r.compare_price, stock: r.stock, sizes: JSON.parse(r.sizes), colors: JSON.parse(r.colors), images: JSON.parse(r.images), coverage, rating_avg: rating.a, rating_count: rating.c, reviews } });
    }
    const revM = p.match(/^\/api\/products\/(\d+)\/reviews$/);
    if (revM && req.method === 'POST') {
      const s = requireAuth(req, res); if (!s) return;
      const pid = Number(revM[1]);
      const prod = db.prepare("SELECT id FROM products WHERE id = ? AND status = 'approved'").get(pid);
      if (!prod) return send(res, 404, { error: 'المنتج غير موجود' });
      const b = await readBody(req);
      const stars = Math.round(Number(b.stars));
      if (!stars || stars < 1 || stars > 5) return send(res, 400, { error: 'اختر تقييماً من 1 إلى 5 نجوم' });
      const eligible = db.prepare(`SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = ? AND o.buyer_id = ? AND o.status = 'delivered_collected' LIMIT 1`).get(pid, s.userId);
      if (!eligible) return send(res, 403, { error: 'يمكنك تقييم المنتج بعد استلام طلبٍ فيه — التقييمات للمشترين الفعليين فقط' });
      db.prepare(`INSERT INTO product_reviews(product_id,user_id,stars,comment,created_at) VALUES(?,?,?,?,?)
        ON CONFLICT(product_id,user_id) DO UPDATE SET stars = excluded.stars, comment = excluded.comment, created_at = excluded.created_at`)
        .run(pid, s.userId, stars, String(b.comment || '').slice(0, 1000), Date.now());
      const rating = db.prepare('SELECT AVG(stars) a, COUNT(*) c FROM product_reviews WHERE product_id = ?').get(pid);
      return send(res, 200, { ok: true, rating_avg: rating.a, rating_count: rating.c });
    }
    // صفحة متجر المورد العامة (كيما نموذج التصميم: متجر بمنتجاته ومعلوماته)
    const followM = p.match(/^\/api\/suppliers\/(\d+)\/follow$/);
    if (followM && req.method === 'GET') {
      const sid = Number(followM[1]);
      const cnt = db.prepare('SELECT COUNT(*) c FROM supplier_follows WHERE supplier_id = ?').get(sid).c;
      let following = false;
      const s = sessionOf(req);
      if (s) following = !!db.prepare('SELECT 1 FROM supplier_follows WHERE user_id = ? AND supplier_id = ?').get(s.userId, sid);
      return send(res, 200, { followers: cnt, following });
    }
    if (followM && req.method === 'POST') {
      const s = requireAuth(req, res); if (!s) return;
      const sid = Number(followM[1]);
      const sup = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'supplier' AND status = 'active'").get(sid);
      if (!sup) return send(res, 404, { error: 'المورد غير موجود' });
      if (sid === s.userId) return send(res, 400, { error: 'لا يمكنك متابعة متجرك' });
      const exists = db.prepare('SELECT 1 FROM supplier_follows WHERE user_id = ? AND supplier_id = ?').get(s.userId, sid);
      if (exists) db.prepare('DELETE FROM supplier_follows WHERE user_id = ? AND supplier_id = ?').run(s.userId, sid);
      else db.prepare('INSERT INTO supplier_follows(user_id, supplier_id, created_at) VALUES(?,?,?)').run(s.userId, sid, Date.now());
      const cnt = db.prepare('SELECT COUNT(*) c FROM supplier_follows WHERE supplier_id = ?').get(sid).c;
      return send(res, 200, { following: !exists, followers: cnt });
    }
    const storeM = p.match(/^\/api\/suppliers\/(\d+)\/public$/);
    if (storeM && req.method === 'GET') {
      const sup = getUser(Number(storeM[1]));
      if (!sup || sup.role !== 'supplier' || sup.status !== 'active') return send(res, 404, { error: 'المتجر غير موجود' });
      const rows = db.prepare(`SELECT p.*, c.name AS category_name,
        (SELECT COALESCE(SUM(oi.qty),0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.status NOT IN ('cancelled','rejected','returned','failed_delivery')) AS sold,
        (SELECT AVG(stars) FROM product_reviews WHERE product_id = p.id) AS rating_avg,
        (SELECT COUNT(*) FROM product_reviews WHERE product_id = p.id) AS rating_count
        FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.supplier_id = ? AND p.status = 'approved' ORDER BY p.id DESC`).all(sup.id)
        .map((r) => ({ id: r.id, supplier_id: r.supplier_id, name: r.name, description: r.description, category_id: r.category_id, category_name: r.category_name, customer_price: customerPrice(r), compare_price: r.compare_price, stock: r.stock, sold: r.sold, sizes: JSON.parse(r.sizes), colors: JSON.parse(r.colors), images: JSON.parse(r.images), in_stock: r.stock > 0 }));
      const wilayaRow = sup.wilaya ? db.prepare('SELECT name_ar FROM wilayas WHERE code = ?').get(sup.wilaya) : null;
      const storeRating = db.prepare('SELECT AVG(pr.stars) a, COUNT(*) c FROM product_reviews pr JOIN products p ON p.id = pr.product_id WHERE p.supplier_id = ?').get(sup.id);
      const storeReviews = db.prepare('SELECT pr.stars, pr.comment, pr.created_at, u.name AS user_name, p.name AS product_name FROM product_reviews pr JOIN products p ON p.id = pr.product_id JOIN users u ON u.id = pr.user_id WHERE p.supplier_id = ? ORDER BY pr.id DESC LIMIT 10').all(sup.id);
      const covCount = db.prepare('SELECT COUNT(*) c FROM supplier_coverage WHERE supplier_id = ?').get(sup.id).c;
      return send(res, 200, { supplier: { id: sup.id, name: sup.name, business_name: sup.business_name, activity: sup.activity, wilaya_name: wilayaRow ? wilayaRow.name_ar : null, member_since: sup.created_at, products_count: rows.length, rating_avg: storeRating.a, rating_count: storeRating.c, coverage_count: covCount, reviews: storeReviews }, products: rows });
    }
    if (p === '/api/support' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b.name || !sec.validPhone(b.phone || '') || !b.message) return send(res, 400, { error: 'أدخل الاسم والهاتف والرسالة' });
      db.prepare('INSERT INTO support_messages(name,phone,message,created_at) VALUES(?,?,?,?)').run(String(b.name).trim(), sec.cleanPhone(b.phone), String(b.message).slice(0, 2000), Date.now());
      return send(res, 201, { ok: true, message: 'وصلت رسالتك — سيرد عليك الدعم في أقرب وقت.' });
    }

    // ---------- إنشاء الطلبات (توجيه آلي للمورد + عمولات snapshot) ----------
    if (p === '/api/orders' && req.method === 'POST') {
      // 120/ساعة: مسوّق نشط يُدخل طلبات زبائنه بنفسه وقد يشارك IP مع غيره — 30 كانت تخنق الاستعمال المشروع (ظهر في اختبارات التدقيق)
      if (!sec.rateLimit('ord:' + req.socket.remoteAddress, 120, 3600e3)) return send(res, 429, { error: 'طلبات كثيرة — حاول لاحقاً' });
      const b = await readBody(req);
      const s = sessionOf(req);
      // من له جلسة يخضع لفحص CSRF وحالة الحساب (الضيف بلا جلسة — تدقيق 2026-10-25)
      if (s) {
        if (s.status !== 'active') return send(res, 403, { error: 'الحساب غير مفعّل بعد أو موقوف' });
        if (req.headers['x-csrf'] !== s.csrf) return send(res, 403, { error: 'رمز حماية الجلسة غير صالح — حدّث الصفحة وحاول مجدداً' });
      }
      if (b.idempotencyKey) {
        const key = String(b.idempotencyKey);
        const seen = new Set(); const existing = [];
        for (const o of db.prepare('SELECT * FROM orders WHERE group_ref = ? OR idempotency_key = ? OR idempotency_key LIKE ?').all(key, key, key + ':%')) {
          if (!seen.has(o.id)) { seen.add(o.id); existing.push(o); }
        }
        if (existing.length) return send(res, 200, { ok: true, duplicate: true, orders: existing.map((o) => ({ ref: o.ref, total: o.total, status: o.status })) });
      }
      const cust = b.customer || {};
      const name = s && s.role === 'buyer' ? (cust.name || s.name) : cust.name;
      const phone = sec.cleanPhone(cust.phone || (s ? s.phone : ''));
      if (!name || !sec.validPhone(phone)) return send(res, 400, { error: 'اسم المشتري وهاتفه الصحيح مطلوبان' });
      const wilaya = Number(cust.wilaya);
      if (!(wilaya >= 1 && wilaya <= 58)) return send(res, 400, { error: 'اختر ولاية صحيحة' });
      if (!cust.commune || !String(cust.commune).trim()) return send(res, 400, { error: 'البلدية مطلوبة' });
      if (!cust.address || !String(cust.address).trim()) return send(res, 400, { error: 'عنوان التوصيل مطلوب' });
      if (!Array.isArray(b.items) || !b.items.length) return send(res, 400, { error: 'السلة فارغة' });

      // التسويق يدوي فقط بلا روابط إحالة: المسوق المسجّل دخوله هو البائع — يحدد سعر البيع بنفسه وعمولته هي الفرق
      let marketerId = null, refCode = null;
      const isMarketerPlacer = !!(s && s.role === 'marketer');
      if (isMarketerPlacer) { marketerId = s.userId; refCode = 'direct-marketer'; }

      const created = [];
      db.exec('BEGIN IMMEDIATE');
      try {
        const bySupplier = new Map();
        for (const it of b.items) {
          const prod = db.prepare("SELECT * FROM products WHERE id = ? AND status = 'approved'").get(Number(it.productId));
          if (!prod) throw Object.assign(new Error('أحد المنتجات غير متاح'), { http: 400 });
          const qty = Number(it.qty);
          if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw Object.assign(new Error(`كمية غير صحيحة لمنتج: ${prod.name} (بين 1 و99)`), { http: 400 });
          if (prod.stock < qty) throw Object.assign(new Error(`المخزون غير كافٍ لمنتج: ${prod.name}`), { http: 400 });
          if (!bySupplier.has(prod.supplier_id)) bySupplier.set(prod.supplier_id, []);
          bySupplier.get(prod.supplier_id).push({ prod, qty, size: it.size || null, color: it.color || null, sellPrice: it.sellPrice });
        }
        const groupRef = b.idempotencyKey ? String(b.idempotencyKey) : sec.newToken(6);
        for (const [supplierId, items] of bySupplier) {
          const cov = db.prepare('SELECT * FROM supplier_coverage WHERE supplier_id = ? AND wilaya_code = ?').get(supplierId, wilaya);
          if (!cov) throw Object.assign(new Error('أحد الموردين لا يغطي ولاية التوصيل المختارة — الطلب مرفوض لهذه الولاية'), { http: 400 });
          // حساب أسعار البيع والعمولات الحرة (نموذج سوقلي) لكل صنف
          for (const it2 of items) {
            const base = customerPrice(it2.prod);
            it2.base = base;
            if (isMarketerPlacer) {
              const minSell = Math.ceil(base * 1.05);
              const sell = it2.sellPrice != null && it2.sellPrice !== '' ? Math.round(Number(it2.sellPrice)) : minSell;
              if (!Number.isFinite(sell) || sell < minSell) throw Object.assign(new Error(`سعر البيع لمنتج «${it2.prod.name}» أقل من الحد الأدنى ${minSell} دج (السعر الأساسي + 5%)`), { http: 400 });
              it2.sell = sell;
              it2.commission = sell - base;
              it2.platformItem = it2.prod.platform_margin;
            } else {
              it2.sell = base;
              it2.commission = 0;
              it2.platformItem = it2.prod.platform_margin;
            }
          }
          let subtotal = 0;
          for (const it2 of items) subtotal += it2.sell * it2.qty;
          // توصيل للمكتب بسعره إن اختاره الزبون وحدده المورد (كيما سوقلي: منزل/مكتب)
          const deliveryFee = cust.deliveryType === 'office' && cov.fee_office != null ? cov.fee_office : cov.delivery_fee;
          const total = subtotal + deliveryFee;
          const info = db.prepare(`INSERT INTO orders(ref,group_ref,buyer_id,guest_name,guest_phone,wilaya,commune,address,supplier_id,marketer_id,ref_code,subtotal,delivery_fee,total,status,idempotency_key,created_at,updated_at)
            VALUES('TEMP',?,?,?,?,?,?,?,?,?,?,?,?,?,'pending_supplier',?,?,?)`)
            .run(groupRef, s && s.role === 'buyer' ? s.userId : null, name, phone, wilaya, String(cust.commune).trim(), String(cust.address).trim(),
              supplierId, marketerId, refCode, subtotal, deliveryFee, total, groupRef + ':' + supplierId, Date.now(), Date.now());
          const oid = Number(info.lastInsertRowid);
          const ref = `PD-${new Date().getFullYear()}-${String(oid).padStart(6, '0')}`;
          db.prepare('UPDATE orders SET ref = ? WHERE id = ?').run(ref, oid);
          let commissionTotal = 0, platformTotal = 0;
          for (const it2 of items) {
            db.prepare(`INSERT INTO order_items(order_id,product_id,qty,size,color,wholesale_price,platform_margin,marketer_commission,customer_price)
              VALUES(?,?,?,?,?,?,?,?,?)`).run(oid, it2.prod.id, it2.qty, it2.size, it2.color, it2.prod.wholesale_price, it2.prod.platform_margin, it2.commission, it2.sell);
            db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(it2.qty, it2.prod.id);
            commissionTotal += it2.commission * it2.qty;
            platformTotal += it2.platformItem * it2.qty;
          }
          if (marketerId) {
            db.prepare(`INSERT INTO commissions(order_id,marketer_id,amount,platform_amount,state,created_at,updated_at)
              VALUES(?,?,?,?,'expected',?,?)`).run(oid, marketerId, commissionTotal, platformTotal, Date.now(), Date.now());
          }
          db.prepare('INSERT INTO order_history(order_id,status,actor_id,note,created_at) VALUES(?,?,?,?,?)')
            .run(oid, 'pending_supplier', s ? s.userId : null, isMarketerPlacer ? 'طلب أنشأه المسوق يدوياً للزبون' : 'طلب مباشر', Date.now());
          created.push(db.prepare('SELECT * FROM orders WHERE id = ?').get(oid));
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        return send(res, e.http || 500, { error: e.message || 'خطأ في إنشاء الطلب' });
      }
      for (const o of created) {
        await notifyOrderEvent(o, 'created');
        await notifyAdmin(orderDigest(o, false));
        audit(s ? s.userId : null, 'order_create', 'order', o.id, o.ref);
      }
      return send(res, 201, { ok: true, orders: created.map((o) => ({ ref: o.ref, total: o.total, delivery_fee: o.delivery_fee, subtotal: o.subtotal, status: o.status, status_label: ORDER_STATUSES[o.status] })) });
    }
    if (p === '/api/orders/track' && req.method === 'GET') {
      const ref = (url.searchParams.get('ref') || '').trim();
      const phone = sec.cleanPhone(url.searchParams.get('phone') || '');
      const o = db.prepare('SELECT * FROM orders WHERE ref = ? AND guest_phone = ?').get(ref, phone);
      if (!o) return send(res, 404, { error: 'لم يتم العثور على طلب بهذا الرقم والهاتف' });
      const hist = db.prepare('SELECT status, note, created_at FROM order_history WHERE order_id = ? ORDER BY id').all(o.id)
        .map((h) => ({ ...h, label: ORDER_STATUSES[h.status] || h.status }));
      const items = db.prepare('SELECT oi.qty, oi.customer_price, oi.size, oi.color, pr.name FROM order_items oi JOIN products pr ON pr.id = oi.product_id WHERE oi.order_id = ?').all(o.id);
      const wilaya = db.prepare('SELECT name_ar FROM wilayas WHERE code = ?').get(o.wilaya);
      const FLOW = ['pending_supplier', 'confirmed', 'preparing', 'handed', 'out_for_delivery', 'delivered_collected'];
      return send(res, 200, {
        order: {
          id: o.id, ref: o.ref, status: o.status, status_label: ORDER_STATUSES[o.status],
          total: o.total, delivery_fee: o.delivery_fee, subtotal: o.subtotal, created_at: o.created_at,
          wilaya: o.wilaya, wilaya_name: wilaya ? wilaya.name_ar : '', commune: o.commune,
          stage: FLOW.indexOf(o.status), flow: FLOW
        },
        items, history: hist
      });
    }
    // الخط الزمني الكامل لطلب — لصاحبه فقط (مشتري/مسوق/مورد معني أو الإدارة)
    const tlM = p.match(/^\/api\/orders\/(\d+)\/timeline$/);
    if (tlM && req.method === 'GET') {
      const s = sessionOf(req);
      if (!s) return send(res, 401, { error: 'يجب تسجيل الدخول أولاً' });
      const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(tlM[1]));
      if (!o) return send(res, 404, { error: 'الطلب غير موجود' });
      const allowed = s.role === 'admin'
        || (s.role === 'buyer' && o.buyer_id === s.userId)
        || (s.role === 'marketer' && o.marketer_id === s.userId)
        || (s.role === 'supplier' && o.supplier_id === s.userId);
      if (!allowed) return send(res, 404, { error: 'الطلب غير موجود' });
      const hist = db.prepare('SELECT status, note, created_at FROM order_history WHERE order_id = ? ORDER BY id').all(o.id)
        .map((h) => ({ ...h, label: ORDER_STATUSES[h.status] || h.status }));
      const items = db.prepare('SELECT oi.qty, oi.customer_price, oi.size, oi.color, pr.name FROM order_items oi JOIN products pr ON pr.id = oi.product_id WHERE oi.order_id = ?').all(o.id);
      const full = s.role !== 'marketer';
      const FLOW = ['pending_supplier', 'confirmed', 'preparing', 'handed', 'out_for_delivery', 'delivered_collected'];
      return send(res, 200, {
        order: {
          id: o.id, ref: o.ref, status: o.status, status_label: ORDER_STATUSES[o.status],
          total: o.total, delivery_fee: o.delivery_fee, subtotal: o.subtotal, created_at: o.created_at, updated_at: o.updated_at,
          wilaya: o.wilaya, commune: o.commune, stage: FLOW.indexOf(o.status), flow: FLOW,
          ...(full ? { guest_name: o.guest_name, guest_phone: o.guest_phone, address: o.address, reject_reason: o.reject_reason } : {})
        },
        items, history: hist
      });
    }
    // تفاصيل كاملة لطلبية برقمها — لكل طرف معني، مع إخفاء ما لا يخصه
    const detM = p.match(/^\/api\/orders\/(\d+)\/details$/);
    if (detM && req.method === 'GET') {
      const s = sessionOf(req);
      if (!s) return send(res, 401, { error: 'يجب تسجيل الدخول أولاً' });
      const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(detM[1]));
      if (!o) return send(res, 404, { error: 'الطلب غير موجود' });
      const allowed = s.role === 'admin'
        || (s.role === 'buyer' && o.buyer_id === s.userId)
        || (s.role === 'marketer' && o.marketer_id === s.userId)
        || (s.role === 'supplier' && o.supplier_id === s.userId);
      if (!allowed) return send(res, 404, { error: 'الطلب غير موجود' });
      const wilaya = db.prepare('SELECT name_ar FROM wilayas WHERE code = ?').get(o.wilaya);
      const supplier = getUser(o.supplier_id);
      const marketer = o.marketer_id ? getUser(o.marketer_id) : null;
      const buyerAcc = o.buyer_id ? getUser(o.buyer_id) : null;
      const itemsRaw = db.prepare('SELECT oi.*, pr.name FROM order_items oi JOIN products pr ON pr.id = oi.product_id WHERE oi.order_id = ?').all(o.id);
      const seeContact = s.role === 'admin' || s.role === 'supplier' || (s.role === 'buyer' && o.buyer_id === s.userId) || (s.role === 'marketer' && o.marketer_id === s.userId);
      const items = itemsRaw.map((i) => ({
        product_id: i.product_id, name: i.name, qty: i.qty, size: i.size, color: i.color, customer_price: i.customer_price,
        line_total: i.customer_price * i.qty,
        ...(s.role === 'admin' || s.role === 'supplier' ? { wholesale_price: i.wholesale_price } : {}),
        ...(s.role === 'admin' ? { platform_margin: i.platform_margin, marketer_commission: i.marketer_commission } : {}),
        ...(s.role === 'marketer' ? { marketer_commission: i.marketer_commission, commission_total: i.marketer_commission * i.qty } : {})
      }));
      const hist = db.prepare('SELECT status, note, created_at FROM order_history WHERE order_id = ? ORDER BY id').all(o.id)
        .map((h) => ({ ...h, label: ORDER_STATUSES[h.status] || h.status }));
      const wholesaleTotal = itemsRaw.reduce((a, i) => a + i.wholesale_price * i.qty, 0);
      const marginTotal = itemsRaw.reduce((a, i) => a + i.platform_margin * i.qty, 0);
      const commissionTotal = o.marketer_id ? itemsRaw.reduce((a, i) => a + i.marketer_commission * i.qty, 0) : 0;
      return send(res, 200, {
        order: {
          id: o.id, ref: o.ref, group_ref: o.group_ref, status: o.status, status_label: ORDER_STATUSES[o.status],
          created_at: o.created_at, updated_at: o.updated_at,
          wilaya: o.wilaya, wilaya_name: wilaya ? wilaya.name_ar : '', commune: o.commune,
          subtotal: o.subtotal, delivery_fee: o.delivery_fee, total: o.total,
          reject_reason: o.reject_reason || null, ship_ref: o.ship_ref || null,
          ...(seeContact ? {
            buyer_name: o.guest_name || (buyerAcc ? buyerAcc.name : null),
            buyer_phone: o.guest_phone || (buyerAcc ? buyerAcc.phone : null),
            address: o.address
          } : {}),
          supplier: supplier ? { id: supplier.id, name: supplier.name, business_name: supplier.business_name } : null,
          ...(s.role === 'admin' || s.role === 'marketer' ? { marketer: marketer ? { id: marketer.id, name: marketer.name, ref_code: o.ref_code } : null } : {}),
          ...(s.role === 'admin' ? { wholesale_total: wholesaleTotal, margin_total: marginTotal, commission_total: commissionTotal, platform_net: (db.prepare('SELECT platform_amount FROM commissions WHERE order_id = ?').get(o.id) || { platform_amount: marginTotal }).platform_amount } : {}),
          ...(s.role === 'supplier' ? { wholesale_total: wholesaleTotal } : {}),
          ...(s.role === 'marketer' ? { commission_total: commissionTotal } : {})
        },
        items, history: hist
      });
    }
    // إشعارات المستخدم داخل التطبيق — قناة التطبيق فقط، بلا سباكة قنوات ولا أسرار (تدقيق 2026-10-25)
    if (p === '/api/my/notifications' && req.method === 'GET') {
      const s = sessionOf(req);
      if (!s) return send(res, 401, { error: 'يجب تسجيل الدخول أولاً' });
      const mask = (t) => String(t || '').replace(/هو:?\s*\d{6}/g, 'هو: ••••••').replace(/(رمز[^:：]*[:：]\s*)\S+/g, '$1••••••');
      const rows = db.prepare("SELECT id, type, payload, created_at, read_at FROM notifications WHERE user_id = ? AND channel = 'log' ORDER BY id DESC LIMIT 30").all(s.userId)
        .map((n) => { let text = ''; try { text = JSON.parse(n.payload).text || ''; } catch {} return { id: n.id, type: n.type, text: n.type === 'password_reset' ? mask(text) : text, created_at: n.created_at, read: !!n.read_at }; });
      const unread = db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND channel = 'log' AND read_at IS NULL").get(s.userId).c;
      return send(res, 200, { notifications: rows, unread });
    }
    if (p === '/api/my/notifications/read' && req.method === 'POST') {
      const s = requireAuth(req, res); if (!s) return;
      db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND channel = 'log' AND read_at IS NULL").run(Date.now(), s.userId);
      return send(res, 200, { ok: true });
    }
    // جلساتي النشطة (عرض/إنهاء) — المعرّف بصمة قصيرة من تجزئة الجلسة، لا التوكن نفسه
    if (p === '/api/me/sessions' && req.method === 'GET') {
      const s = requireAuth(req, res); if (!s) return;
      const myHash = sec.hashToken(s.token);
      const rows = db.prepare('SELECT token_hash, created_at, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC').all(s.userId)
        .map((r) => ({ key: r.token_hash.slice(0, 10), created_at: r.created_at, expires_at: r.expires_at, current: r.token_hash === myHash }));
      return send(res, 200, { sessions: rows });
    }
    const sessDelM = p.match(/^\/api\/me\/sessions\/([a-f0-9]{10})$/);
    if (sessDelM && req.method === 'DELETE') {
      const s = requireAuth(req, res); if (!s) return;
      const row = db.prepare('SELECT * FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 10) = ?').get(s.userId, sessDelM[1]);
      if (!row) return send(res, 404, { error: 'الجلسة غير موجودة' });
      if (row.token_hash === sec.hashToken(s.token)) return send(res, 400, { error: 'هذه جلستك الحالية — استعمل تسجيل الخروج لإنهائها' });
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
      return send(res, 200, { ok: true });
    }
    // أسعار التوصيل العامة: أرخص رسم لكل ولاية عبر الموردين النشطين (لصفحة أسعار التوصيل)
    if (p === '/api/communes' && req.method === 'GET') {
      const w = Number(url.searchParams.get('wilaya'));
      if (!w) return send(res, 400, { error: 'اختر الولاية أولاً' });
      try {
        if (!globalThis.__communes) globalThis.__communes = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'communes.json'), 'utf8'));
        return send(res, 200, { communes: globalThis.__communes[String(w)] || [] });
      } catch { return send(res, 200, { communes: [] }); }
    }
    if (p === '/api/delivery-coverage' && req.method === 'GET') {
      // كيما سوقلي: سعر منزل وسعر مكتب ومدة التوصيل لكل ولاية (أرخص الأسعار بين الموردين النشطين)
      const rows = db.prepare(`SELECT sc.wilaya_code, MIN(sc.delivery_fee) AS min_fee, MIN(COALESCE(sc.fee_office, sc.delivery_fee)) AS min_office_fee, COUNT(DISTINCT sc.supplier_id) AS suppliers, w.name_ar,
          (SELECT sc2.duration FROM supplier_coverage sc2 JOIN users u2 ON u2.id = sc2.supplier_id AND u2.status = 'active' WHERE sc2.wilaya_code = sc.wilaya_code AND sc2.duration IS NOT NULL ORDER BY sc2.delivery_fee ASC LIMIT 1) AS duration
        FROM supplier_coverage sc JOIN users u ON u.id = sc.supplier_id AND u.status = 'active' JOIN wilayas w ON w.code = sc.wilaya_code
        GROUP BY sc.wilaya_code ORDER BY sc.wilaya_code`).all();
      return send(res, 200, { coverage: rows });
    }
    if (p === '/api/my/orders' && req.method === 'GET') {
      const s = requireAuth(req, res, ['buyer']); if (!s) return;
      const rows = db.prepare('SELECT * FROM orders WHERE buyer_id = ? ORDER BY id DESC').all(s.userId)
        .map((o) => ({ ...o, status_label: ORDER_STATUSES[o.status] }));
      return send(res, 200, { orders: rows });
    }
    // إلغاء المشتري لطلب ما زال جديداً
    const cancelM = p.match(/^\/api\/my\/orders\/(\d+)\/cancel$/);
    if (cancelM && req.method === 'POST') {
      const s = requireAuth(req, res, ['buyer']); if (!s) return;
      const o = db.prepare('SELECT * FROM orders WHERE id = ? AND buyer_id = ?').get(Number(cancelM[1]), s.userId);
      if (!o) return send(res, 404, { error: 'الطلب غير موجود' });
      const r = changeOrderStatus(o, 'cancelled', s.userId, 'ألغاه المشتري');
      if (r.error) return send(res, 400, { error: r.error });
      await notifyOrderEvent(o, 'status', ORDER_STATUSES.cancelled);
      return send(res, 200, { ok: true });
    }

    // ---------- المورد ----------
    if (p === '/api/supplier/coverage' && req.method === 'GET') {
      const s = requireAuth(req, res, ['supplier']); if (!s) return;
      return send(res, 200, { coverage: db.prepare('SELECT * FROM supplier_coverage WHERE supplier_id = ? ORDER BY wilaya_code').all(s.userId) });
    }
    if (p === '/api/supplier/coverage' && req.method === 'PUT') {
      const s = requireAuth(req, res, ['supplier']); if (!s) return;
      const b = await readBody(req);
      if (!Array.isArray(b.coverage)) return send(res, 400, { error: 'بيانات التغطية غير صحيحة' });
      // تحقق كامل قبل أي حذف: صف فاسد واحد يرفض الحفظ كله وتبقى التغطية السابقة سليمة (تدقيق 2026-10-25)
      const clean = [];
      for (const c of b.coverage) {
        const w = Number(c.wilaya_code), f = Number(c.delivery_fee);
        const fo = c.fee_office != null && c.fee_office !== '' ? Number(c.fee_office) : null;
        if (!Number.isInteger(w) || w < 1 || w > 58) return send(res, 400, { error: `ولاية غير صحيحة في التغطية: ${c.wilaya_code}` });
        if (!Number.isFinite(f) || f < 0) return send(res, 400, { error: `رسم توصيل غير صحيح لولاية ${w}` });
        if (fo != null && (!Number.isFinite(fo) || fo < 0)) return send(res, 400, { error: `رسم مكتب غير صحيح لولاية ${w}` });
        clean.push([s.userId, w, Math.round(f), fo != null ? Math.round(fo) : null, c.duration ? String(c.duration).slice(0, 40) : null]);
      }
      if (!clean.length && b.clear !== true) return send(res, 400, { error: 'أرسل ولاية واحدة على الأقل — لم تُمسح تغطيتك الحالية' });
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM supplier_coverage WHERE supplier_id = ?').run(s.userId);
        const ins = db.prepare('INSERT INTO supplier_coverage(supplier_id,wilaya_code,delivery_fee,fee_office,duration) VALUES(?,?,?,?,?)');
        for (const row of clean) ins.run(...row);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); return send(res, 500, { error: 'خطأ في حفظ التغطية' }); }
      audit(s.userId, 'coverage_update', 'supplier', s.userId, null);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/upload' && req.method === 'POST') {
      const s = requireAuth(req, res, ['supplier', 'admin']); if (!s) return;
      const b = await readBody(req);
      const m = String(b.dataUrl || '').match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
      if (!m) return send(res, 400, { error: 'صورة غير صالحة — PNG أو JPG أو WebP فقط' });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 1.5 * 1024 * 1024) return send(res, 400, { error: 'الصورة أكبر من 1.5MB' });
      // فحص التوقيع الحقيقي للملف (magic bytes) — بادئة الـdata URL وحدها لا تكفي (تدقيق 2026-10-25)
      const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      const isWebp = buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
      const kind = isPng ? 'png' : isJpg ? 'jpg' : isWebp ? 'webp' : null;
      if (!kind) return send(res, 400, { error: 'الملف المرفوع ليس صورة حقيقية (PNG/JPG/WebP)' });
      const ext = kind;
      const fname = `${Date.now()}-${sec.newToken(6)}.${ext}`;
      fs.writeFileSync(path.join(UPLOADS, fname), buf);
      return send(res, 201, { ok: true, url: '/uploads/' + fname });
    }
    if (p === '/api/supplier/products' && req.method === 'GET') {
      const s = requireAuth(req, res, ['supplier']); if (!s) return;
      const rows = db.prepare('SELECT * FROM products WHERE supplier_id = ? ORDER BY id DESC').all(s.userId)
        .map((r) => ({ ...r, customer_price: customerPrice(r), sizes: JSON.parse(r.sizes), colors: JSON.parse(r.colors), images: JSON.parse(r.images) }));
      return send(res, 200, { products: rows });
    }
    if (p === '/api/supplier/products' && req.method === 'POST') {
      const s = requireAuth(req, res, ['supplier']); if (!s) return;
      const b = await readBody(req);
      const v = validateProduct(b);
      if (v.error) return send(res, 400, { error: v.error });
      const info = db.prepare(`INSERT INTO products(supplier_id,category_id,name,description,wholesale_price,stock,sizes,colors,images,status,compare_price,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,'pending_review',?,?,?)`)
        .run(s.userId, v.category_id, v.name, v.description, v.wholesale_price, v.stock, JSON.stringify(v.sizes), JSON.stringify(v.colors), JSON.stringify(v.images), v.compare_price, Date.now(), Date.now());
      audit(s.userId, 'product_create', 'product', info.lastInsertRowid, v.name);
      await integ.notify({ channel: 'log', type: 'product_pending', text: `منتج جديد بانتظار مراجعة الإدارة: ${v.name}` });
      await notifyAdmin(`📦 منتج جديد بانتظار اعتماد الإدارة في منصة SOUQAR: ${v.name}`);
      return send(res, 201, { ok: true, id: Number(info.lastInsertRowid), message: 'أُرسل المنتج لمراجعة الإدارة — لن يظهر للزبائن قبل الاعتماد.' });
    }
    const supProdM = p.match(/^\/api\/supplier\/products\/(\d+)$/);
    if (supProdM && req.method === 'PUT') {
      const s = requireAuth(req, res, ['supplier']); if (!s) return;
      const prod = db.prepare('SELECT * FROM products WHERE id = ? AND supplier_id = ?').get(Number(supProdM[1]), s.userId);
      if (!prod) return send(res, 404, { error: 'المنتج غير موجود' });
      const b = await readBody(req);
      const v = validateProduct(b);
      if (v.error) return send(res, 400, { error: v.error });
      let status = prod.status;
      if (status === 'approved' && (v.wholesale_price !== prod.wholesale_price || v.name !== prod.name)) status = 'pending_review';
      if (b.paused === true && status === 'approved') status = 'paused';
      if (b.paused === false && status === 'paused') status = 'approved';
      db.prepare(`UPDATE products SET category_id=?,name=?,description=?,wholesale_price=?,stock=?,sizes=?,colors=?,images=?,status=?,compare_price=?,updated_at=? WHERE id=?`)
        .run(v.category_id, v.name, v.description, v.wholesale_price, v.stock, JSON.stringify(v.sizes), JSON.stringify(v.colors), JSON.stringify(v.images), status, v.compare_price, Date.now(), prod.id);
      audit(s.userId, 'product_update', 'product', prod.id, status);
      return send(res, 200, { ok: true, status });
    }
    if (p === '/api/supplier/orders' && req.method === 'GET') {
      const s = requireAuth(req, res, ['supplier']); if (!s) return;
      const rows = db.prepare('SELECT * FROM orders WHERE supplier_id = ? ORDER BY id DESC').all(s.userId).map((o) => ({
        ...o, status_label: ORDER_STATUSES[o.status],
        // تشكيل صريح: هامش المنصة وعمولة المسوق تفاصيل داخلية لا تصل للمورد (تدقيق 2026-10-25)
        items: db.prepare('SELECT oi.id, oi.order_id, oi.product_id, oi.qty, oi.size, oi.color, oi.wholesale_price, oi.customer_price, p.name FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?').all(o.id)
      }));
      return send(res, 200, { orders: rows });
    }
    const supOrdM = p.match(/^\/api\/supplier\/orders\/(\d+)\/status$/);
    if (supOrdM && req.method === 'POST') {
      const s = requireAuth(req, res, ['supplier', 'admin']); if (!s) return;
      const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(supOrdM[1]));
      if (!o || (s.role === 'supplier' && o.supplier_id !== s.userId)) return send(res, 404, { error: 'الطلب غير موجود' });
      const b = await readBody(req);
      const r = changeOrderStatus(o, String(b.status || ''), s.userId, b.note || null, b.reason || null, s.role === 'admin');
      if (r.error) return send(res, 400, { error: r.error });
      if (b.shipRef && ['handed', 'out_for_delivery'].includes(b.status)) db.prepare('UPDATE orders SET ship_ref = ? WHERE id = ?').run(String(b.shipRef).slice(0, 60), o.id);
      await notifyOrderEvent(o, 'status', ORDER_STATUSES[b.status]);
      if (b.status === 'delivered_collected' && o.marketer_id) {
        const cm = db.prepare('SELECT amount FROM commissions WHERE order_id = ?').get(o.id);
        if (cm && cm.amount > 0) {
          const mkText = `💰 طلبك ${o.ref} سُلّم وحُصّل بنجاح — عمولتك ${cm.amount} دج أصبحت موافقاً عليها في محفظتك في SOUQAR`;
          await integ.notify({ userId: o.marketer_id, channel: 'telegram', type: 'order_update', text: mkText });
          await integ.notify({ userId: o.marketer_id, channel: 'log', type: 'order_update', text: mkText });
        }
      }
      return send(res, 200, { ok: true });
    }
    // توثيق محاولة اتصال بالزبون (ضد الطلبات الوهمية) — تُسجَّل في الخط الزمني للطلب
    const supContactM = p.match(/^\/api\/supplier\/orders\/(\d+)\/contact$/);
    if (supContactM && req.method === 'POST') {
      const s = requireAuth(req, res, ['supplier', 'admin']); if (!s) return;
      const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(supContactM[1]));
      if (!o || (s.role === 'supplier' && o.supplier_id !== s.userId)) return send(res, 404, { error: 'الطلب غير موجود' });
      const b = await readBody(req);
      const RESULTS = { answered: '📞 اتصلت بالزبون: ردّ وأكّد الطلب', no_answer: '📞 اتصلت بالزبون: لا يرد', wrong_number: '📞 اتصلت بالزبون: رقم خاطئ/مغلق', postponed: '📞 الزبون طلب تأجيل التسليم' };
      if (!RESULTS[b.result]) return send(res, 400, { error: 'اختر نتيجة الاتصال' });
      db.prepare('INSERT INTO order_history(order_id,status,actor_id,note,created_at) VALUES(?,?,?,?,?)')
        .run(o.id, o.status, s.userId, RESULTS[b.result] + (b.note ? ' — ' + String(b.note).slice(0, 200) : ''), Date.now());
      audit(s.userId, 'order_contact', 'order', o.id, b.result);
      return send(res, 201, { ok: true });
    }
    if (p === '/api/supplier/reports' && req.method === 'GET') {
      const s = requireAuth(req, res, ['supplier']); if (!s) return;
      const byStatus = db.prepare('SELECT status, COUNT(*) c, COALESCE(SUM(total),0) sum FROM orders WHERE supplier_id = ? GROUP BY status').all(s.userId);
      const delivered = db.prepare("SELECT COALESCE(SUM(total),0) sum, COUNT(*) c FROM orders WHERE supplier_id = ? AND status = 'delivered_collected'").get(s.userId);
      const lowStock = db.prepare('SELECT id, name, stock FROM products WHERE supplier_id = ? AND stock <= 3 ORDER BY stock').all(s.userId);
      return send(res, 200, { byStatus, delivered, lowStock });
    }

    // ---------- المسوق ----------
    if (p === '/api/marketer/products' && req.method === 'GET') {
      const s = requireAuth(req, res, ['marketer']); if (!s) return;
      const rows = db.prepare(`SELECT p.id, p.name, p.description, p.wholesale_price, p.platform_margin, p.stock, p.category_id, p.sizes, p.colors, p.images, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.status = 'approved' ORDER BY p.id DESC`).all()
        .map((r) => ({ id: r.id, name: r.name, description: r.description, customer_price: customerPrice(r), stock: r.stock, category_id: r.category_id, category_name: r.category_name, sizes: JSON.parse(r.sizes), colors: JSON.parse(r.colors), images: JSON.parse(r.images), in_stock: r.stock > 0 }));
      return send(res, 200, { products: rows });
    }
    if (p === '/api/marketer/orders' && req.method === 'GET') {
      const s = requireAuth(req, res, ['marketer']); if (!s) return;
      const rows = db.prepare('SELECT id, ref, subtotal, delivery_fee, total, status, created_at FROM orders WHERE marketer_id = ? ORDER BY id DESC').all(s.userId)
        .map((o) => ({ ...o, status_label: ORDER_STATUSES[o.status] }));
      return send(res, 200, { orders: rows });
    }
    if (p === '/api/my/wallet' && req.method === 'GET') {
      const s = requireAuth(req, res, ['marketer']); if (!s) return;
      const sum = (sql, ...a) => db.prepare(sql).get(...a).s;
      const waiting = sum(`SELECT COALESCE(SUM(cm.amount),0) s FROM commissions cm JOIN orders o ON o.id = cm.order_id WHERE cm.marketer_id = ? AND cm.state = 'expected' AND o.status IN ('pending_supplier','confirmed','preparing','failed_delivery')`, s.userId);
      const inDelivery = sum(`SELECT COALESCE(SUM(cm.amount),0) s FROM commissions cm JOIN orders o ON o.id = cm.order_id WHERE cm.marketer_id = ? AND cm.state = 'expected' AND o.status IN ('handed','out_for_delivery')`, s.userId);
      const approved = sum("SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE marketer_id = ? AND state = 'payable'", s.userId);
      const paid = sum("SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE marketer_id = ? AND state = 'paid'", s.userId);
      const commFree = sum("SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE marketer_id = ? AND state = 'payable' AND settlement_id IS NULL AND payout_request_id IS NULL", s.userId);
      const bonusesFree = sum('SELECT COALESCE(SUM(amount),0) s FROM invite_bonuses WHERE inviter_id = ? AND settlement_id IS NULL AND payout_request_id IS NULL', s.userId);
      const requested = sum(`SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE marketer_id = ? AND payout_request_id IN (SELECT id FROM payout_requests WHERE state = 'pending')`, s.userId)
        + sum(`SELECT COALESCE(SUM(amount),0) s FROM invite_bonuses WHERE inviter_id = ? AND payout_request_id IN (SELECT id FROM payout_requests WHERE state = 'pending')`, s.userId);
      const bonusesTotal = sum('SELECT COALESCE(SUM(amount),0) s FROM invite_bonuses WHERE inviter_id = ?', s.userId);
      const balance = commFree + bonusesFree;
      const earned = waiting + inDelivery + approved + paid + bonusesTotal;
      return send(res, 200, { wallet: { waiting, inDelivery, approved, paid, requested, bonuses: bonusesTotal, balance, earned } });
    }
    // طلبات سحب الأرباح — المسوّق يطلب، والإدارة تدفع خارج المنصة وتوثّق (قرار المستخدم 2026-10-25)
    if (p === '/api/my/payout-requests' && req.method === 'GET') {
      const s = requireAuth(req, res, ['marketer']); if (!s) return;
      const rows = db.prepare('SELECT * FROM payout_requests WHERE marketer_id = ? ORDER BY id DESC LIMIT 30').all(s.userId);
      return send(res, 200, { requests: rows });
    }
    if (p === '/api/my/payout-requests' && req.method === 'POST') {
      const s = requireAuth(req, res, ['marketer']); if (!s) return;
      const me = getUser(s.userId);
      const b = await readBody(req);
      const method = b.method ? String(b.method).trim() : (me.payment_method || '');
      if (!PAY_METHODS.includes(method)) return send(res, 400, { error: 'اختر وسيلة السحب: بريدي موب / البريد الجاري (CCP) / Flexy / Enveloppe / من مقر المنصة / نقداً من الإدارة' });
      const details = (b.details ? String(b.details).trim() : (me.payment_details || '')).slice(0, 200);
      const needsDetails = !['التحصيل من مقر المنصة', 'نقداً عند الاستلام من الإدارة'].includes(method);
      if (needsDetails && !details) return send(res, 400, { error: 'اكتب تفاصيل وسيلة السحب (رقم الحساب/الهاتف) — أو اضبطها أولاً في إعدادات حسابك' });
      const amount = Math.round(Number(b.amount));
      const pending = db.prepare("SELECT id FROM payout_requests WHERE marketer_id = ? AND state = 'pending'").get(s.userId);
      if (pending) return send(res, 409, { error: 'عندك طلب سحب قيد المعالجة — انتظر نتيجته قبل طلب جديد' });
      const commFree = db.prepare("SELECT * FROM commissions WHERE marketer_id = ? AND state = 'payable' AND settlement_id IS NULL AND payout_request_id IS NULL ORDER BY id").all(s.userId);
      const bonFree = db.prepare('SELECT * FROM invite_bonuses WHERE inviter_id = ? AND settlement_id IS NULL AND payout_request_id IS NULL ORDER BY id').all(s.userId);
      const available = commFree.reduce((a, c) => a + c.amount, 0) + bonFree.reduce((a, c) => a + c.amount, 0);
      if (!Number.isFinite(amount) || amount < 1) return send(res, 400, { error: 'اكتب مبلغ السحب' });
      if (amount > available) return send(res, 400, { error: `المبلغ أكبر من رصيدك القابل للسحب الآن: ${available} دج` });
      db.exec('BEGIN IMMEDIATE');
      let reqId;
      try {
        const info = db.prepare('INSERT INTO payout_requests(marketer_id,amount,method,details,state,created_at,updated_at) VALUES(?,?,?,?,\'pending\',?,?)')
          .run(s.userId, amount, method, details || null, Date.now(), Date.now());
        reqId = Number(info.lastInsertRowid);
        let left = amount;
        for (const c of commFree) { if (left <= 0) break; db.prepare('UPDATE commissions SET payout_request_id = ? WHERE id = ?').run(reqId, c.id); left -= c.amount; }
        for (const bn of bonFree) { if (left <= 0) break; db.prepare('UPDATE invite_bonuses SET payout_request_id = ? WHERE id = ?').run(reqId, bn.id); left -= bn.amount; }
        // العمولة لا تتجزأ: المبلغ الفعلي = مجموع العمولات/المكافآت المرتبطة كاملة (قد يتجاوز المطلوب بقليل) — يُعلن للمسوّق كما هو
        const eff = db.prepare('SELECT (SELECT COALESCE(SUM(amount),0) FROM commissions WHERE payout_request_id = ?) + (SELECT COALESCE(SUM(amount),0) FROM invite_bonuses WHERE payout_request_id = ?) s').get(reqId, reqId).s;
        db.prepare('UPDATE payout_requests SET amount = ? WHERE id = ?').run(eff, reqId);
        db.exec('COMMIT');
        var effectiveAmount = eff;
      } catch (e) { db.exec('ROLLBACK'); return send(res, 500, { error: 'تعذر إنشاء طلب السحب' }); }
      audit(s.userId, 'payout_request', 'payout_request', reqId, `${effectiveAmount} via ${method}`);
      await notifyAdmin(`💸 طلب سحب أرباح جديد #${reqId} — ${me.name} (${me.phone}) — ${effectiveAmount} دج — ${method}${details ? ' — ' + details : ''} — عالِجه من لوحة الإدارة ← المدفوعات`);
      await integ.notify({ userId: s.userId, channel: 'log', type: 'payout', text: `📨 استلمنا طلب سحبك #${reqId} بمبلغ ${effectiveAmount} دج عبر ${method} — قيد المعالجة، وسيصلك تأكيد عند الدفع.` });
      return send(res, 201, { ok: true, requestId: reqId, amount: effectiveAmount, message: 'وصل طلب سحبك — قيد المعالجة عند الإدارة.' });
    }
    if (p === '/api/my/invite' && req.method === 'GET') {
      const s = requireAuth(req, res); if (!s) return;
      let me = getUser(s.userId);
      if (!me.invite_code) {
        const code = 'PD' + sec.newToken(4).toUpperCase();
        db.prepare('UPDATE users SET invite_code = ? WHERE id = ?').run(code, me.id);
        me = getUser(me.id);
      }
      const invited = db.prepare('SELECT id, name, created_at FROM users WHERE invited_by = ? ORDER BY id DESC').all(me.id)
        .map((u) => {
          const earned = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE marketer_id = ? AND state IN ('payable','paid')").get(u.id).s;
          const bonus = db.prepare('SELECT amount FROM invite_bonuses WHERE invitee_id = ?').get(u.id);
          return { name: u.name, earned, remaining: Math.max(0, 5000 - earned), bonusPaid: bonus ? bonus.amount : 0, joinedAt: u.created_at };
        });
      const bonusesEarned = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM invite_bonuses WHERE inviter_id = ?').get(me.id).s;
      return send(res, 200, { code: me.invite_code, invitedCount: invited.length, invited, bonusesEarned, rule: { bonus: 500, threshold: 5000 } });
    }
    if (p === '/api/marketer/commissions' && req.method === 'GET') {
      const s = requireAuth(req, res, ['marketer']); if (!s) return;
      const rows = db.prepare(`SELECT cm.*, o.ref FROM commissions cm JOIN orders o ON o.id = cm.order_id WHERE cm.marketer_id = ? ORDER BY cm.id DESC`).all(s.userId);
      const sums = {};
      for (const st of ['expected', 'confirmed', 'payable', 'paid', 'cancelled'])
        sums[st] = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE marketer_id = ? AND state = ?').get(s.userId, st).s;
      const settlements = db.prepare('SELECT * FROM settlements WHERE marketer_id = ? ORDER BY id DESC').all(s.userId);
      return send(res, 200, { commissions: rows, sums, settlements });
    }
    // ---------- الإدارة العامة ----------
    if (p === '/api/admin/overview' && req.method === 'GET') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const usersByRole = db.prepare('SELECT role, status, COUNT(*) c FROM users GROUP BY role, status').all();
      const ordersByStatus = db.prepare('SELECT status, COUNT(*) c, COALESCE(SUM(total),0) sum FROM orders GROUP BY status').all();
      const platformEarned = db.prepare("SELECT COALESCE(SUM(platform_amount),0) s FROM commissions WHERE state IN ('confirmed','payable','paid')").get().s;
      const marketerDue = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE state = 'payable'").get().s;
      const pendingSuppliers = db.prepare("SELECT COUNT(*) c FROM users WHERE role='supplier' AND status='pending'").get().c;
      const pendingProducts = db.prepare("SELECT COUNT(*) c FROM products WHERE status='pending_review'").get().c;
      const failedNotifications = db.prepare("SELECT COUNT(*) c FROM notifications WHERE status IN ('failed','queued_not_configured')").get().c;
      const lateOrders = db.prepare("SELECT id, ref, status, created_at FROM orders WHERE status IN ('pending_supplier','confirmed','preparing') AND created_at < ? ORDER BY created_at LIMIT 20").all(Date.now() - 48 * 3600e3);
      return send(res, 200, { usersByRole, ordersByStatus, platformEarned, marketerDue, pendingSuppliers, pendingProducts, failedNotifications, lateOrders });
    }
    if (p === '/api/admin/users' && req.method === 'GET') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const role = url.searchParams.get('role');
      const rows = (role ? db.prepare('SELECT * FROM users WHERE role = ? ORDER BY id DESC').all(role)
        : db.prepare('SELECT * FROM users ORDER BY id DESC').all()).map(publicUser);
      return send(res, 200, { users: rows });
    }
    const userActM = p.match(/^\/api\/admin\/users\/(\d+)\/action$/);
    if (userActM && req.method === 'POST') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const target = getUser(Number(userActM[1]));
      if (!target || target.role === 'admin') return send(res, 404, { error: 'المستخدم غير موجود' });
      const b = await readBody(req);
      const map = { approve: 'active', activate: 'active', reject: 'rejected', suspend: 'suspended' };
      const st = map[b.action];
      if (!st) return send(res, 400, { error: 'إجراء غير معروف' });
      db.prepare('UPDATE users SET status = ?, reject_reason = ? WHERE id = ?').run(st, b.action === 'reject' ? (b.reason || null) : null, target.id);
      if (st !== 'active') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      audit(s.userId, 'user_' + b.action, 'user', target.id, b.reason || null);
      return send(res, 200, { ok: true, status: st });
    }
    if (p === '/api/admin/products' && req.method === 'GET') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const rows = db.prepare(`SELECT p.*, u.name AS supplier_name FROM products p JOIN users u ON u.id = p.supplier_id ORDER BY p.id DESC`).all()
        .map((r) => ({ ...r, customer_price: customerPrice(r), platform_net: r.platform_margin, images: JSON.parse(r.images) }));
      return send(res, 200, { products: rows });
    }
    const prodRevM = p.match(/^\/api\/admin\/products\/(\d+)\/review$/);
    if (prodRevM && req.method === 'POST') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(prodRevM[1]));
      if (!prod) return send(res, 404, { error: 'المنتج غير موجود' });
      const b = await readBody(req);
      if (b.action === 'reject') {
        db.prepare("UPDATE products SET status='rejected', reject_reason=?, updated_at=? WHERE id=?").run(b.reason || null, Date.now(), prod.id);
        audit(s.userId, 'product_reject', 'product', prod.id, b.reason || null);
        return send(res, 200, { ok: true, status: 'rejected' });
      }
      if (b.action === 'approve') {
        // نموذج سوقلي: الإدارة تحدد هامش المنصة فقط — عمولة المسوق حرة يحددها بنفسه عند الطلب (الفرق فوق السعر الأساسي، 5% على الأقل)
        const margin = Math.round(Number(b.platformMargin));
        if (!Number.isFinite(margin) || margin < 0) return send(res, 400, { error: 'هامش المنصة غير صحيح' });
        db.prepare("UPDATE products SET status='approved', platform_margin=?, marketer_commission=0, reject_reason=NULL, updated_at=? WHERE id=?")
          .run(margin, Date.now(), prod.id);
        audit(s.userId, 'product_approve', 'product', prod.id, `margin=${margin} commission=free`);
        await integ.notify({ userId: prod.supplier_id, channel: 'log', type: 'product_approved', text: `تم اعتماد منتجك: ${prod.name} — سعر الزبون الآن ${prod.wholesale_price + margin} دج` });
        return send(res, 200, { ok: true, status: 'approved' });
      }
      return send(res, 400, { error: 'إجراء غير معروف' });
    }
    if (p === '/api/admin/categories' && req.method === 'POST') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const b = await readBody(req);
      if (!b.name || !String(b.name).trim()) return send(res, 400, { error: 'اسم التصنيف مطلوب' });
      try {
        const info = db.prepare('INSERT INTO categories(name,created_at) VALUES(?,?)').run(String(b.name).trim(), Date.now());
        return send(res, 201, { ok: true, id: Number(info.lastInsertRowid) });
      } catch { return send(res, 409, { error: 'التصنيف موجود مسبقاً' }); }
    }
    const catAdmM = p.match(/^\/api\/admin\/categories\/(\d+)$/);
    if (catAdmM && req.method === 'PATCH') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const b = await readBody(req);
      const name = String(b.name || '').trim();
      if (!name) return send(res, 400, { error: 'اسم التصنيف مطلوب' });
      try {
        const r = db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, Number(catAdmM[1]));
        if (!r.changes) return send(res, 404, { error: 'التصنيف غير موجود' });
        return send(res, 200, { ok: true });
      } catch { return send(res, 409, { error: 'يوجد تصنيف آخر بهذا الاسم' }); }
    }
    if (catAdmM && req.method === 'DELETE') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const cid = Number(catAdmM[1]);
      const used = db.prepare('SELECT COUNT(*) c FROM products WHERE category_id = ?').get(cid).c;
      if (used) return send(res, 409, { error: `لا يمكن حذف تصنيف فيه ${used} منتجاً — انقل منتجاته لتصنيف آخر أولاً` });
      db.prepare('DELETE FROM categories WHERE id = ?').run(cid);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/orders' && req.method === 'GET') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const rows = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 300').all()
        .map((o) => ({ ...o, status_label: ORDER_STATUSES[o.status] }));
      return send(res, 200, { orders: rows });
    }
    if (p === '/api/admin/settlements' && req.method === 'GET') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const payable = db.prepare(`SELECT u.id AS marketer_id, u.name, u.phone, u.payment_method, u.payment_details,
        (SELECT COALESCE(SUM(amount),0) FROM commissions WHERE marketer_id = u.id AND state = 'payable' AND settlement_id IS NULL AND payout_request_id IS NULL) AS commissions_sum,
        (SELECT COALESCE(SUM(amount),0) FROM invite_bonuses WHERE inviter_id = u.id AND settlement_id IS NULL AND payout_request_id IS NULL) AS bonuses_sum
        FROM users u WHERE u.role = 'marketer'`).all()
        .map((r) => ({ ...r, total: r.commissions_sum + r.bonuses_sum })).filter((r) => r.total > 0);
      const payments = db.prepare(`SELECT st.*, u.name AS marketer_name, u.phone AS marketer_phone FROM settlements st JOIN users u ON u.id = st.marketer_id WHERE st.state = 'paid' ORDER BY st.id DESC`).all();
      const payoutRequests = db.prepare(`SELECT pr.*, u.name AS marketer_name, u.phone AS marketer_phone FROM payout_requests pr JOIN users u ON u.id = pr.marketer_id ORDER BY (pr.state = 'pending') DESC, pr.id DESC LIMIT 50`).all();
      return send(res, 200, { payable, payments, payoutRequests });
    }
    // معالجة طلب سحب: تأكيد بعد دفع فعلي خارج المنصة (بالطريقة والمرجع) أو رفض يحرّر العمولات
    const prActM = p.match(/^\/api\/admin\/payout-requests\/(\d+)\/(confirm|reject)$/);
    if (prActM && req.method === 'POST') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const pr = db.prepare('SELECT * FROM payout_requests WHERE id = ?').get(Number(prActM[1]));
      if (!pr) return send(res, 404, { error: 'طلب السحب غير موجود' });
      if (pr.state !== 'pending') return send(res, 409, { error: 'هذا الطلب عولج من قبل' });
      const b = await readBody(req);
      if (prActM[2] === 'reject') {
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('UPDATE commissions SET payout_request_id = NULL WHERE payout_request_id = ?').run(pr.id);
          db.prepare('UPDATE invite_bonuses SET payout_request_id = NULL WHERE payout_request_id = ?').run(pr.id);
          db.prepare("UPDATE payout_requests SET state = 'rejected', admin_note = ?, updated_at = ? WHERE id = ?").run(b.reason ? String(b.reason).slice(0, 300) : 'رُفض من الإدارة', Date.now(), pr.id);
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); return send(res, 500, { error: 'خطأ في رفض الطلب' }); }
        audit(s.userId, 'payout_reject', 'payout_request', pr.id, b.reason || null);
        await integ.notify({ userId: pr.marketer_id, channel: 'log', type: 'payout', text: `❌ رُفض طلب سحبك #${pr.id} (${pr.amount} دج)${b.reason ? ' — السبب: ' + b.reason : ''}. رصيدك بقي كما هو في محفظتك.` });
        return send(res, 200, { ok: true });
      }
      const method = b.method ? String(b.method).trim() : pr.method;
      if (!PAY_METHODS.includes(method)) return send(res, 400, { error: 'اختر طريقة الدفع الفعلية' });
      if (['تحويل بريدي موب', 'تحويل البريد الجاري', 'Flexy'].includes(method) && !(b.reference && String(b.reference).trim())) return send(res, 400, { error: 'مرجع العملية مطلوب لتوثيق الدفع (رقم التحويل أو العملية)' });
      const comms = db.prepare("SELECT * FROM commissions WHERE payout_request_id = ? AND state = 'payable'").all(pr.id);
      const bons = db.prepare('SELECT * FROM invite_bonuses WHERE payout_request_id = ? AND settlement_id IS NULL').all(pr.id);
      const amount = comms.reduce((a, c) => a + c.amount, 0) + bons.reduce((a, x) => a + x.amount, 0);
      if (!amount) return send(res, 400, { error: 'لا عمولات مرتبطة قابلة للدفع في هذا الطلب (ربما أُلغيت طلباتها)' });
      db.exec('BEGIN IMMEDIATE');
      let sid;
      try {
        const info = db.prepare(`INSERT INTO settlements(marketer_id,amount,state,method,reference,note,created_at,updated_at) VALUES(?,?,'paid',?,?,?,?,?)`)
          .run(pr.marketer_id, amount, method, b.reference ? String(b.reference).trim() : null, (b.note || ('طلب سحب #' + pr.id)), Date.now(), Date.now());
        sid = Number(info.lastInsertRowid);
        const upd = db.prepare("UPDATE commissions SET settlement_id = ?, state = 'paid', payout_request_id = NULL, updated_at = ? WHERE id = ?");
        for (const c of comms) upd.run(sid, Date.now(), c.id);
        const updB = db.prepare('UPDATE invite_bonuses SET settlement_id = ?, payout_request_id = NULL WHERE id = ?');
        for (const bn of bons) updB.run(sid, bn.id);
        db.prepare("UPDATE payout_requests SET state = 'paid', admin_method = ?, admin_reference = ?, admin_note = ?, settlement_id = ?, updated_at = ? WHERE id = ?")
          .run(method, b.reference ? String(b.reference).trim() : null, b.note || null, sid, Date.now(), pr.id);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); return send(res, 500, { error: 'خطأ في توثيق دفع طلب السحب' }); }
      audit(s.userId, 'payout_confirm', 'payout_request', pr.id, b.reference || method);
      await integ.notify({ userId: pr.marketer_id, channel: 'log', type: 'payout', text: `✅ دُفع طلب سحبك #${pr.id}: ${amount} دج عبر ${method}${b.reference ? ' — مرجع العملية: ' + b.reference : ''}. تجده في سجل مدفوعاتك.` });
      await integ.notify({ userId: pr.marketer_id, channel: 'telegram', type: 'payout', text: `✅ دُفع طلب سحبك #${pr.id} في SOUQAR: ${amount} دج عبر ${method}${b.reference ? ' — مرجع: ' + b.reference : ''}` });
      return send(res, 201, { ok: true, settlementId: sid, amount });
    }
    if (p === '/api/admin/payments/confirm' && req.method === 'POST') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const b = await readBody(req);
      const METHODS = ['تحويل بريدي موب', 'تحويل البريد الجاري', 'التحصيل من مقر المنصة', 'Enveloppe', 'Flexy', 'نقداً عند الاستلام من الإدارة'];
      if (!METHODS.includes(b.method)) return send(res, 400, { error: 'اختر طريقة الدفع الفعلية: بريدي موب / CCP / Flexy / نقداً' });
      if (['تحويل بريدي موب', 'تحويل البريد الجاري', 'Flexy'].includes(b.method) && !(b.reference && String(b.reference).trim())) return send(res, 400, { error: 'مرجع العملية مطلوب لتوثيق الدفع (رقم التحويل أو العملية)' });
      const marketer = getUser(Number(b.marketerId));
      if (!marketer || marketer.role !== 'marketer') return send(res, 404, { error: 'المسوق غير موجود' });
      // العمولات المرتبطة بطلب سحب معلّق تُدفع من مسار الطلب فقط — لا تُدفع مرتين من هنا
      const payable = db.prepare("SELECT * FROM commissions WHERE marketer_id = ? AND state = 'payable' AND settlement_id IS NULL AND payout_request_id IS NULL").all(marketer.id);
      const bonuses = db.prepare('SELECT * FROM invite_bonuses WHERE inviter_id = ? AND settlement_id IS NULL AND payout_request_id IS NULL').all(marketer.id);
      const amount = payable.reduce((a, c) => a + c.amount, 0) + bonuses.reduce((a, x) => a + x.amount, 0);
      if (!amount) return send(res, 400, { error: 'لا رصيد قابل للدفع لهذا المسوق حالياً' });
      db.exec('BEGIN IMMEDIATE');
      try {
        const info = db.prepare(`INSERT INTO settlements(marketer_id,amount,state,method,reference,note,created_at,updated_at) VALUES(?,?,'paid',?,?,?,?,?)`)
          .run(marketer.id, amount, b.method, b.reference ? String(b.reference).trim() : null, b.note || null, Date.now(), Date.now());
        const sid = Number(info.lastInsertRowid);
        const upd = db.prepare("UPDATE commissions SET settlement_id = ?, state = 'paid', updated_at = ? WHERE id = ?");
        for (const c of payable) upd.run(sid, Date.now(), c.id);
        const updB = db.prepare('UPDATE invite_bonuses SET settlement_id = ? WHERE id = ?');
        for (const bn of bonuses) updB.run(sid, bn.id);
        db.exec('COMMIT');
        audit(s.userId, 'payment_confirm', 'settlement', sid, b.reference || b.method);
        await integ.notify({ channel: 'log', type: 'payment_confirmed', text: `دفع موثّق #${sid} بمبلغ ${amount} دج للمسوق ${marketer.name} عبر ${b.method} — مرجع: ${b.reference || 'نقداً'}` });
        return send(res, 201, { ok: true, settlementId: sid, amount });
      } catch (e) { db.exec('ROLLBACK'); return send(res, 500, { error: 'خطأ في توثيق الدفع' }); }
    }
    if (p === '/api/admin/integrations' && req.method === 'GET') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      return send(res, 200, { integrations: integ.integrationStatus(), statuses: ORDER_STATUSES, suppliersOpen: suppliersOpen() });
    }
    if (p === '/api/admin/integrations/suppliers' && req.method === 'POST') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const b = await readBody(req);
      const open = b.open === true;
      db.prepare("INSERT INTO settings(key,value) VALUES('suppliers_open',?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(open ? '1' : '0');
      audit(s.userId, open ? 'suppliers_opened' : 'suppliers_closed', 'settings', null, 'from admin panel');
      return send(res, 200, { ok: true, suppliersOpen: open });
    }
    if (p === '/api/admin/integrations/telegram' && req.method === 'POST') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const b = await readBody(req);
      const setK = (k, val) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, val);
      if (b.token !== undefined) {
        const tok = String(b.token || '').trim();
        if (tok && !/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(tok)) return send(res, 400, { error: 'صيغة التوكن غير صحيحة — الصقه كاملاً كما أعطاه BotFather' });
        if (tok) setK('telegram_bot_token', tok); else db.prepare("DELETE FROM settings WHERE key = 'telegram_bot_token'").run();
      }
      if (b.chatId !== undefined) {
        const cid = String(b.chatId || '').trim();
        if (cid && !/^-?\d{5,}$/.test(cid)) return send(res, 400, { error: 'معرّف المحادثة يجب أن يكون رقماً' });
        if (cid) setK('admin_telegram_chat_id', cid); else db.prepare("DELETE FROM settings WHERE key = 'admin_telegram_chat_id'").run();
      }
      audit(s.userId, 'telegram_config', 'settings', null, 'bot token/chat updated from admin');
      return send(res, 200, { ok: true, integrations: integ.integrationStatus() });
    }
    if (p === '/api/admin/integrations/telegram/test' && req.method === 'POST') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      try { return send(res, 200, await integ.telegramTest()); }
      catch (e) { return send(res, 200, { ok: false, error: 'تعذر الوصول إلى تيليغرام من الخادم حالياً — أعد المحاولة بعد قليل' }); }
    }
    if (p === '/api/admin/notifications' && req.method === 'GET') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      return send(res, 200, { notifications: db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 100').all() });
    }
    const notifM = p.match(/^\/api\/admin\/notifications\/(\d+)\/retry$/);
    if (notifM && req.method === 'POST') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const r = await integ.attemptNotification(Number(notifM[1]));
      return send(res, 200, { ok: r.ok, result: r });
    }
    if (p === '/api/admin/audit' && req.method === 'GET') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      return send(res, 200, { logs: db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200').all() });
    }
    if (p === '/api/admin/support' && req.method === 'GET') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      return send(res, 200, { messages: db.prepare('SELECT * FROM support_messages ORDER BY id DESC LIMIT 100').all() });
    }
    // ردّ/إغلاق رسالة دعم — الرد يُحفظ ويُشعَر صاحب الحساب إن وُجد برقم هاتفه
    const supMsgM = p.match(/^\/api\/admin\/support\/(\d+)\/(reply|close)$/);
    if (supMsgM && req.method === 'POST') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const msg = db.prepare('SELECT * FROM support_messages WHERE id = ?').get(Number(supMsgM[1]));
      if (!msg) return send(res, 404, { error: 'الرسالة غير موجودة' });
      const b = await readBody(req);
      if (supMsgM[2] === 'reply') {
        const text = String(b.text || '').trim();
        if (!text) return send(res, 400, { error: 'اكتب نص الرد' });
        db.prepare("UPDATE support_messages SET reply = ?, status = 'replied' WHERE id = ?").run(text.slice(0, 2000), msg.id);
        const u = db.prepare('SELECT id FROM users WHERE phone = ?').get(msg.phone);
        if (u) await integ.notify({ userId: u.id, channel: 'log', type: 'support', text: `💬 ردّ الدعم على رسالتك («${msg.message.slice(0, 60)}…»): ${text.slice(0, 300)}` });
        audit(s.userId, 'support_reply', 'support_message', msg.id, null);
        return send(res, 200, { ok: true });
      }
      db.prepare("UPDATE support_messages SET status = 'closed' WHERE id = ?").run(msg.id);
      return send(res, 200, { ok: true });
    }
    // تصدير CSV (Excel يفتحه بالعربية مع BOM)
    function csvOut(res2, name, header, lines) {
      const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const body = '﻿' + header.map(esc).join(',') + '\n' + lines.map((r) => r.map(esc).join(',')).join('\n');
      res2.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` });
      return res2.end(body);
    }
    if (p === '/api/admin/export/orders.csv' && req.method === 'GET') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const rows = db.prepare(`SELECT o.*, u.name AS supplier_name, m.name AS marketer_name FROM orders o JOIN users u ON u.id = o.supplier_id LEFT JOIN users m ON m.id = o.marketer_id ORDER BY o.id DESC LIMIT 2000`).all();
      return csvOut(res, 'orders.csv', ['المرجع', 'التاريخ', 'الحالة', 'المشتري', 'الهاتف', 'الولاية', 'البلدية', 'المورد', 'المسوق', 'المجموع الفرعي', 'التوصيل', 'الإجمالي'],
        rows.map((o) => [o.ref, new Date(o.created_at).toISOString().slice(0, 10), ORDER_STATUSES[o.status] || o.status, o.guest_name || '', o.guest_phone || '', o.wilaya, o.commune || '', o.supplier_name, o.marketer_name || '', o.subtotal, o.delivery_fee, o.total]));
    }
    if (p === '/api/admin/export/payments.csv' && req.method === 'GET') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const rows = db.prepare(`SELECT st.*, u.name AS marketer_name, u.phone FROM settlements st JOIN users u ON u.id = st.marketer_id WHERE st.state = 'paid' ORDER BY st.id DESC`).all();
      return csvOut(res, 'payments.csv', ['رقم الدفع', 'التاريخ', 'المسوق', 'الهاتف', 'المبلغ', 'الطريقة', 'المرجع', 'ملاحظة'],
        rows.map((r) => [r.id, new Date(r.created_at).toISOString().slice(0, 10), r.marketer_name, r.phone, r.amount, r.method || '', r.reference || '', r.note || '']));
    }
    if (p === '/api/supplier/export/orders.csv' && req.method === 'GET') {
      const s = requireAuth(req, res, ['supplier']); if (!s) return;
      const rows = db.prepare('SELECT * FROM orders WHERE supplier_id = ? ORDER BY id DESC LIMIT 2000').all(s.userId);
      return csvOut(res, 'my-orders.csv', ['المرجع', 'التاريخ', 'الحالة', 'المشتري', 'الهاتف', 'الولاية', 'البلدية', 'العنوان', 'الإجمالي'],
        rows.map((o) => [o.ref, new Date(o.created_at).toISOString().slice(0, 10), ORDER_STATUSES[o.status] || o.status, o.guest_name || '', o.guest_phone || '', o.wilaya, o.commune || '', o.address || '', o.total]));
    }
    if (p === '/api/admin/backup' && req.method === 'POST') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const fname = `platform-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
      const dest = path.join(DATA_DIR, 'backups', fname).replace(/'/g, '');
      db.exec(`VACUUM INTO '${dest}'`);
      audit(s.userId, 'backup', 'database', fname, null);
      return send(res, 201, { ok: true, file: fname, note: 'نسخة احتياطية كاملة من قاعدة البيانات في مجلد data/backups على الخادم' });
    }

    // أيقونات التطبيق تُولّد برمجياً (بلا ملفات ثنائية في المستودع)
    if ((p === '/icons/icon-192.png' || p === '/icons/icon-512.png') && req.method === 'GET') {
      const buf = iconPNG(p.includes('512') ? 512 : 192);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      return res.end(buf);
    }

    // صورة شاشة البداية (من لوحة تصميم المستخدم) — تُفكّ من Base64 داخل الكود
    if (p === '/splash-bg.jpg' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': splashBg.contentType, 'Cache-Control': 'public, max-age=604800' });
      return res.end(SPLASH_BUF);
    }

    // صورة بانر الواجهة الرئيسية — تُفكّ من Base64 داخل الكود
    if (p === '/hero-bg.jpg' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': heroBg.contentType, 'Cache-Control': 'public, max-age=604800' });
      return res.end(HERO_BUF);
    }

    // صورة منتج Nutrifresh (أكواب القياس) — أصلها Base64 في بيانات المتجر
    if (p === '/pimg/nutrifresh-mesures.jpg' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': pimgData.contentType, 'Cache-Control': 'public, max-age=604800' });
      return res.end(PIMG_BUF);
    }

    // ---------- ملفات ثابتة ----------
    if (req.method === 'GET') {
      let file = p === '/' ? path.join(PUBLIC, 'index.html') : path.join(PUBLIC, p);
      if (p.startsWith('/uploads/')) file = path.join(UPLOADS, path.basename(p));
      if (!file.startsWith(PUBLIC) && !file.startsWith(UPLOADS)) return send(res, 403, { error: 'forbidden' });
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ext = path.extname(file).toLowerCase();
        const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        return res.end(fs.readFileSync(file));
      }
    }
    return send(res, 404, { error: 'غير موجود' });
  } catch (e) {
    if (e && e.message === 'bad_json') { if (!res.headersSent) send(res, 400, { error: 'جسم الطلب ليس JSON صالحاً' }); return; }
    if (e && e.message === 'too_large') { if (!res.headersSent) send(res, 413, { error: 'حجم الطلب أكبر من المسموح' }); return; }
    console.error('server error', e);
    try {
      db.prepare('INSERT INTO notifications(channel,type,payload,status,created_at) VALUES(?,?,?,?,?)')
        .run('log', 'server_error', JSON.stringify({ text: String(e.message || e), path: p }), 'queued', Date.now());
    } catch {}
    if (!res.headersSent) send(res, 500, { error: 'خطأ داخلي — تم تسجيله في سجل الأخطاء' });
  }
});

function validateProduct(b) {
  const name = String(b.name || '').trim();
  if (!name) return { error: 'اسم المنتج مطلوب' };
  const wholesale = Math.round(Number(b.wholesalePrice));
  if (!Number.isFinite(wholesale) || wholesale < 0) return { error: 'سعر الجملة غير صحيح' };
  const stock = Math.round(Number(b.stock));
  if (!Number.isFinite(stock) || stock < 0) return { error: 'المخزون غير صحيح' };
  const images = Array.isArray(b.images) ? b.images.filter((x) => typeof x === 'string').slice(0, 6) : [];
  const sizes = Array.isArray(b.sizes) ? b.sizes.map(String).slice(0, 20) : [];
  const colors = Array.isArray(b.colors) ? b.colors.map(String).slice(0, 20) : [];
  let category_id = null;
  if (b.categoryId) {
    const c = db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(b.categoryId));
    if (!c) return { error: 'التصنيف غير موجود' };
    category_id = c.id;
  } else {
    // بلا تصنيف مختار → «عام» حتى لا يبقى أي منتج بلا قسم (تدقيق 2026-10-25)
    const g = db.prepare("SELECT id FROM categories WHERE name = 'عام'").get();
    category_id = g ? g.id : null;
  }
  const compare = b.comparePrice != null && b.comparePrice !== '' ? Math.round(Number(b.comparePrice)) : null;
  return { name, wholesale_price: wholesale, stock, images, sizes, colors, category_id, description: String(b.description || '').slice(0, 5000), compare_price: compare != null && Number.isFinite(compare) && compare > 0 ? compare : null };
}

// مكافأة «ادعو أصدقائك» كيما سوقلي: 500 دج للداعي عندما تبلغ أرباح المدعو المؤكدة 5000 دج
function maybeInviteBonus(inviteeId) {
  const invitee = getUser(inviteeId);
  if (!invitee || !invitee.invited_by) return;
  const earned = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE marketer_id = ? AND state IN ('payable','paid')").get(inviteeId).s;
  if (earned < 5000) return;
  if (db.prepare('SELECT id FROM invite_bonuses WHERE invitee_id = ?').get(inviteeId)) return;
  db.prepare('INSERT INTO invite_bonuses(inviter_id,invitee_id,amount,created_at) VALUES(?,?,500,?)')
    .run(invitee.invited_by, inviteeId, Date.now());
  integ.notify({ userId: invitee.invited_by, channel: 'log', type: 'invite_bonus', text: `🎉 مبروك! ربحت مكافأة دعوة 500 دج لأن صديقك المدعو ${invitee.name} بلغت أرباحه المؤكدة 5000 دج. أُضيفت المكافأة إلى رصيدك القابل للسحب.` }).catch(() => {});
  notifyAdmin(`🎁 مكافأة دعوة 500 دج لمستخدم #${invitee.invited_by} — المدعو #${inviteeId} بلغ 5000 دج أرباحاً`).catch(() => {});
}

function changeOrderStatus(o, newStatus, actorId, note, reason, force = false) {
  if (!ORDER_STATUSES[newStatus]) return { error: 'حالة غير معروفة' };
  const allowed = TRANSITIONS[o.status] || [];
  if (!force && !allowed.includes(newStatus)) return { error: `لا يمكن الانتقال من «${ORDER_STATUSES[o.status]}» إلى «${ORDER_STATUSES[newStatus]}»` };
  if ((newStatus === 'rejected' || newStatus === 'cancelled') && o.status === 'pending_supplier' && !reason && !note)
    return { error: 'اذكر سبب الرفض أو الإلغاء' };
  // حرّاس مالية (تدقيق 2026-10-25): عمولة مدفوعة وموثّقة لا تُكسر بأي انتقال — ولا حتى بقوة الإدارة
  const negTarget = ['cancelled', 'rejected', 'returned'].includes(newStatus);
  if (negTarget) {
    const cm0 = db.prepare('SELECT state FROM commissions WHERE order_id = ?').get(o.id);
    if (cm0 && cm0.state === 'paid') return { error: 'عمولة هذا الطلب مدفوعة وموثّقة بسجل دفع — لا يمكن إلغاء الطلب أو إرجاعه آلياً؛ عالِجها يدوياً مع المسوّق' };
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const negative = ['cancelled', 'rejected', 'returned'].includes(newStatus);
    let restored = o.stock_restored;
    if (negative && !o.stock_restored) {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
      for (const it of items) db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(it.qty, it.product_id);
      restored = 1;
    }
    if (newStatus === 'delivered_collected') {
      db.prepare("UPDATE commissions SET state='payable', updated_at=? WHERE order_id=? AND state='expected'").run(Date.now(), o.id);
      if (o.marketer_id) maybeInviteBonus(o.marketer_id);
    }
    if (negative) {
      const cm = db.prepare('SELECT * FROM commissions WHERE order_id = ?').get(o.id);
      if (cm && ['expected', 'confirmed', 'payable'].includes(cm.state)) {
        if (cm.payout_request_id) {
          // فكّ ارتباط طلب السحب وإنقاص مبلغه بقدر هذه العمولة — وإن صفر المبلغ يُغلق الطلب تلقائياً
          const pr = db.prepare("SELECT * FROM payout_requests WHERE id = ? AND state = 'pending'").get(cm.payout_request_id);
          if (pr) {
            const newAmt = Math.max(0, pr.amount - cm.amount);
            if (newAmt <= 0) db.prepare("UPDATE payout_requests SET state = 'rejected', amount = 0, admin_note = 'أُلغي تلقائياً: أُلغيت/رُجعت كل طلبات هذا السحب', updated_at = ? WHERE id = ?").run(Date.now(), pr.id);
            else db.prepare('UPDATE payout_requests SET amount = ?, updated_at = ? WHERE id = ?').run(newAmt, Date.now(), pr.id);
          }
          db.prepare('UPDATE commissions SET payout_request_id = NULL WHERE id = ?').run(cm.id);
        }
        if (cm.settlement_id) {
          const st = db.prepare('SELECT * FROM settlements WHERE id = ?').get(cm.settlement_id);
          if (st && st.state !== 'paid') {
            const remaining = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM commissions WHERE settlement_id = ? AND id != ?').get(st.id, cm.id).s;
            db.prepare('UPDATE settlements SET amount = ?, updated_at = ? WHERE id = ?').run(remaining, Date.now(), st.id);
            if (remaining <= 0) db.prepare("UPDATE settlements SET state='rejected', note='أُلغيت لأن كل طلباتها أُلغيت/رجعت' WHERE id = ?").run(st.id);
          }
        }
        db.prepare("UPDATE commissions SET state='cancelled', settlement_id=NULL, updated_at=? WHERE id=?").run(Date.now(), cm.id);
      }
    }
    db.prepare('UPDATE orders SET status=?, reject_reason=?, stock_restored=?, updated_at=? WHERE id=?')
      .run(newStatus, newStatus === 'rejected' ? (reason || note || null) : o.reject_reason, restored, Date.now(), o.id);
    db.prepare('INSERT INTO order_history(order_id,status,actor_id,note,created_at) VALUES(?,?,?,?,?)')
      .run(o.id, newStatus, actorId, note || reason || null, Date.now());
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); return { error: 'خطأ في تحديث الحالة: ' + e.message }; }
  audit(actorId, 'order_status', 'order', o.id, `${o.status} -> ${newStatus}`);
  return { ok: true };
}

if (require.main === module) {
  const BIND_HOST = process.env.HOST || process.env.IP || null;
  if (BIND_HOST) server.listen(PORT, BIND_HOST, () => console.log(`SOUQAR platform running on http://${BIND_HOST}:${PORT}`));
  else server.listen(PORT, () => console.log(`SOUQAR platform running on http://localhost:${PORT}`));
}
module.exports = { server, ORDER_STATUSES };
