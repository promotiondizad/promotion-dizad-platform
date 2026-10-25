'use strict';
// خادم منصة Promotion Dizad — Node.js مدمج فقط، بلا اعتماديات خارجية
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
const sec = require('./security');
const integ = require('./integrations');

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
  delivered_collected: [], cancelled: [], rejected: [], returned: []
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

const ADMIN_CHAT = process.env.ADMIN_TELEGRAM_CHAT_ID || '';
async function notifyAdmin(text) {
  if (ADMIN_CHAT) await integ.notify({ channel: 'telegram', type: 'admin_alert', text, target: ADMIN_CHAT });
}
async function notifyOrderParties(order, text) {
  await integ.notify({ userId: order.supplier_id, channel: 'telegram', type: 'order_update', text });
  await integ.notify({ userId: order.supplier_id, channel: 'log', type: 'order_update', text });
  if (order.marketer_id) await integ.notify({ userId: order.marketer_id, channel: 'log', type: 'order_update', text });
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
      if (!b.name || !String(b.name).trim()) return send(res, 400, { error: 'الاسم مطلوب' });
      if (!sec.validPhone(b.phone || '')) return send(res, 400, { error: 'رقم هاتف غير صحيح' });
      if (!sec.strongPassword(b.password || '')) return send(res, 400, { error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
      if (b.password !== b.passwordConfirm) return send(res, 400, { error: 'تأكيد كلمة المرور غير مطابق' });
      if (b.terms !== true) return send(res, 400, { error: 'يجب الموافقة على الشروط للمتابعة' });
      if (role === 'supplier' && !b.activity) return send(res, 400, { error: 'معلومات النشاط مطلوبة للمورد' });
      const phone = sec.cleanPhone(b.phone);
      if (db.prepare('SELECT id FROM users WHERE phone = ?').get(phone)) return send(res, 409, { error: 'يوجد حساب مسجل بهذا الرقم — سجّل الدخول' });
      const status = role === 'supplier' ? 'pending' : 'active';
      const info = db.prepare(`INSERT INTO users(role,name,phone,email,password_hash,wilaya,commune,address,business_name,activity,telegram_chat_id,status,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?, ?, ?)`)
        .run(role, String(b.name).trim(), phone, b.email || null, sec.hashPassword(b.password),
          b.wilaya ? Number(b.wilaya) : null, b.commune || null, b.address || null,
          b.businessName || null, b.activity || null, b.telegramChatId || null, status, Date.now());
      const id = Number(info.lastInsertRowid);
      audit(id, 'register', 'user', id, role);
      if (role === 'supplier') { await integ.notify({ channel: 'log', type: 'supplier_pending', text: `مورد جديد بانتظار المراجعة: ${b.name} (${phone})` }); await notifyAdmin(`🏭 مورد جديد بانتظار مراجعة الإدارة في منصة Promotion Dizad: ${b.name} (${phone})`); }
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
      return send(res, 200, { ok: true, user: publicUser(user), csrf }, {
        'Set-Cookie': `pd_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 3600}`
      });
    }
    if (p === '/api/auth/logout' && req.method === 'POST') {
      const s = sessionOf(req); if (s) sec.destroySession(s.token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'pd_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    }
    if (p === '/api/auth/forgot' && req.method === 'POST') {
      const b = await readBody(req);
      const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(sec.cleanPhone(b.phone || ''));
      if (user) {
        const token = sec.newToken(20);
        db.prepare('INSERT INTO password_resets(user_id,token,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)')
          .run(user.id, token, sec.hashToken(token), Date.now() + 30 * 60e3, Date.now());
        await integ.notify({ userId: user.id, channel: 'log', type: 'password_reset', text: `رمز استعادة كلمة المرور (صالح 30 دقيقة): ${token}` });
        if (user.telegram_chat_id) await integ.notify({ userId: user.id, channel: 'telegram', type: 'password_reset', text: `Promotion Dizad — رمز استعادة كلمة المرور (30 دقيقة): ${token}` });
      }
      return send(res, 200, { ok: true, message: 'إذا كان الرقم مسجلاً، تم إرسال رمز الاستعادة عبر قنوات الإشعار المضبوطة.' });
    }
    if (p === '/api/auth/reset' && req.method === 'POST') {
      const b = await readBody(req);
      if (!sec.strongPassword(b.password || '')) return send(res, 400, { error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
      if (b.password !== b.passwordConfirm) return send(res, 400, { error: 'تأكيد كلمة المرور غير مطابق' });
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
      let sql = `SELECT p.*, c.name AS category_name, u.business_name, u.name AS supplier_name
        FROM products p LEFT JOIN categories c ON c.id = p.category_id JOIN users u ON u.id = p.supplier_id
        WHERE p.status = 'approved' AND u.status = 'active'`;
      const args = [];
      if (q) { sql += ' AND (p.name LIKE ? OR p.description LIKE ?)'; args.push('%' + q + '%', '%' + q + '%'); }
      if (cat) { sql += ' AND p.category_id = ?'; args.push(Number(cat)); }
      sql += ' ORDER BY p.id DESC';
      const rows = db.prepare(sql).all(...args).map((r) => ({
        ...r, customer_price: customerPrice(r),
        sizes: JSON.parse(r.sizes), colors: JSON.parse(r.colors), images: JSON.parse(r.images),
        in_stock: r.stock > 0
      }));
      return send(res, 200, { products: rows });
    }
    const pm = p.match(/^\/api\/products\/(\d+)$/);
    if (pm && req.method === 'GET') {
      const r = db.prepare(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`).get(Number(pm[1]));
      if (!r || r.status !== 'approved') return send(res, 404, { error: 'المنتج غير موجود أو غير متاح' });
      const coverage = db.prepare('SELECT wilaya_code, delivery_fee FROM supplier_coverage WHERE supplier_id = ? ORDER BY wilaya_code').all(r.supplier_id);
      return send(res, 200, { product: { ...r, customer_price: customerPrice(r), sizes: JSON.parse(r.sizes), colors: JSON.parse(r.colors), images: JSON.parse(r.images), coverage } });
    }
    // رابط إحالة: عدّ النقرة + كوكي 30 يوماً + تحويل للمتجر
    const rm = p.match(/^\/r\/([A-Za-z0-9]+)$/);
    if (rm && req.method === 'GET') {
      const link = db.prepare('SELECT * FROM referral_links WHERE code = ?').get(rm[1]);
      if (link) {
        db.prepare('UPDATE referral_links SET clicks = clicks + 1 WHERE id = ?').run(link.id);
        const dest = link.product_id ? `/?ref=${link.code}&product=${link.product_id}` : `/?ref=${link.code}`;
        res.writeHead(302, { Location: dest, 'Set-Cookie': `pd_ref=${link.code}; Path=/; Max-Age=${30 * 24 * 3600}; SameSite=Lax` });
        return res.end();
      }
      res.writeHead(302, { Location: '/' }); return res.end();
    }
    if (p === '/api/support' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b.name || !sec.validPhone(b.phone || '') || !b.message) return send(res, 400, { error: 'أدخل الاسم والهاتف والرسالة' });
      db.prepare('INSERT INTO support_messages(name,phone,message,created_at) VALUES(?,?,?,?)').run(String(b.name).trim(), sec.cleanPhone(b.phone), String(b.message).slice(0, 2000), Date.now());
      return send(res, 201, { ok: true, message: 'وصلت رسالتك — سيرد عليك الدعم في أقرب وقت.' });
    }

    // ---------- إنشاء الطلبات (توجيه آلي للمورد + عمولات snapshot) ----------
    if (p === '/api/orders' && req.method === 'POST') {
      if (!sec.rateLimit('ord:' + req.socket.remoteAddress, 30, 3600e3)) return send(res, 429, { error: 'طلبات كثيرة — حاول لاحقاً' });
      const b = await readBody(req);
      const s = sessionOf(req);
      if (b.idempotencyKey) {
        const existing = db.prepare('SELECT * FROM orders WHERE idempotency_key = ?').all(String(b.idempotencyKey))
          .concat(db.prepare('SELECT * FROM orders WHERE group_ref = ?').all(String(b.idempotencyKey)));
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

      // حلّ الإحالة: آخر رابط صالح استخدمه المشتري (قاعدة موثقة في الشروط)
      let marketerId = null, refCode = null;
      const refCandidate = b.refCode || (req.headers.cookie || '').match(/pd_ref=([A-Za-z0-9]+)/)?.[1];
      if (refCandidate) {
        const link = db.prepare('SELECT * FROM referral_links WHERE code = ?').get(String(refCandidate));
        if (link) {
          const mk = getUser(link.marketer_id);
          if (mk && mk.status === 'active' && mk.phone !== phone) { marketerId = mk.id; refCode = link.code; }
        }
      }

      const created = [];
      db.exec('BEGIN IMMEDIATE');
      try {
        const bySupplier = new Map();
        for (const it of b.items) {
          const prod = db.prepare("SELECT * FROM products WHERE id = ? AND status = 'approved'").get(Number(it.productId));
          if (!prod) throw Object.assign(new Error('أحد المنتجات غير متاح'), { http: 400 });
          const qty = Math.max(1, Math.min(99, Number(it.qty) || 1));
          if (prod.stock < qty) throw Object.assign(new Error(`المخزون غير كافٍ لمنتج: ${prod.name}`), { http: 400 });
          if (!bySupplier.has(prod.supplier_id)) bySupplier.set(prod.supplier_id, []);
          bySupplier.get(prod.supplier_id).push({ prod, qty, size: it.size || null, color: it.color || null });
        }
        const groupRef = b.idempotencyKey ? String(b.idempotencyKey) : sec.newToken(6);
        for (const [supplierId, items] of bySupplier) {
          const cov = db.prepare('SELECT * FROM supplier_coverage WHERE supplier_id = ? AND wilaya_code = ?').get(supplierId, wilaya);
          if (!cov) throw Object.assign(new Error('أحد الموردين لا يغطي ولاية التوصيل المختارة — الطلب مرفوض لهذه الولاية'), { http: 400 });
          let subtotal = 0;
          for (const { prod, qty } of items) subtotal += customerPrice(prod) * qty;
          const total = subtotal + cov.delivery_fee;
          const info = db.prepare(`INSERT INTO orders(ref,group_ref,buyer_id,guest_name,guest_phone,wilaya,commune,address,supplier_id,marketer_id,ref_code,subtotal,delivery_fee,total,status,idempotency_key,created_at,updated_at)
            VALUES('TEMP',?,?,?,?,?,?,?,?,?,?,?,?,?,'pending_supplier',?,?,?)`)
            .run(groupRef, s && s.role === 'buyer' ? s.userId : null, name, phone, wilaya, String(cust.commune).trim(), String(cust.address).trim(),
              supplierId, marketerId, refCode, subtotal, cov.delivery_fee, total, groupRef, Date.now(), Date.now());
          const oid = Number(info.lastInsertRowid);
          const ref = `PD-${new Date().getFullYear()}-${String(oid).padStart(6, '0')}`;
          db.prepare('UPDATE orders SET ref = ? WHERE id = ?').run(ref, oid);
          let commissionTotal = 0, platformTotal = 0;
          for (const { prod, qty, size, color } of items) {
            db.prepare(`INSERT INTO order_items(order_id,product_id,qty,size,color,wholesale_price,platform_margin,marketer_commission,customer_price)
              VALUES(?,?,?,?,?,?,?,?,?)`).run(oid, prod.id, qty, size, color, prod.wholesale_price, prod.platform_margin, prod.marketer_commission, customerPrice(prod));
            db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, prod.id);
            commissionTotal += prod.marketer_commission * qty;
            platformTotal += (prod.platform_margin - prod.marketer_commission) * qty;
          }
          if (marketerId) {
            db.prepare(`INSERT INTO commissions(order_id,marketer_id,amount,platform_amount,state,created_at,updated_at)
              VALUES(?,?,?,?,'expected',?,?)`).run(oid, marketerId, commissionTotal, platformTotal, Date.now(), Date.now());
          }
          db.prepare('INSERT INTO order_history(order_id,status,actor_id,note,created_at) VALUES(?,?,?,?,?)')
            .run(oid, 'pending_supplier', s ? s.userId : null, marketerId ? 'طلب عبر رابط إحالة ' + refCode : 'طلب مباشر', Date.now());
          created.push(db.prepare('SELECT * FROM orders WHERE id = ?').get(oid));
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        return send(res, e.http || 500, { error: e.message || 'خطأ في إنشاء الطلب' });
      }
      for (const o of created) {
        await notifyOrderParties(o, `طلب جديد ${o.ref} بمبلغ ${o.total} دج بانتظار تأكيدك في لوحة المورد — Promotion Dizad`);
        await notifyAdmin(`🛒 طلب جديد في منصة Promotion Dizad: ${o.ref} — ${o.total} دج — ولاية ${o.wilaya}`);
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
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM supplier_coverage WHERE supplier_id = ?').run(s.userId);
        const ins = db.prepare('INSERT INTO supplier_coverage(supplier_id,wilaya_code,delivery_fee) VALUES(?,?,?)');
        for (const c of b.coverage) {
          const w = Number(c.wilaya_code), f = Number(c.delivery_fee);
          if (w >= 1 && w <= 58 && Number.isFinite(f) && f >= 0) ins.run(s.userId, w, Math.round(f));
        }
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
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
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
      const info = db.prepare(`INSERT INTO products(supplier_id,category_id,name,description,wholesale_price,stock,sizes,colors,images,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,'pending_review',?,?)`)
        .run(s.userId, v.category_id, v.name, v.description, v.wholesale_price, v.stock, JSON.stringify(v.sizes), JSON.stringify(v.colors), JSON.stringify(v.images), Date.now(), Date.now());
      audit(s.userId, 'product_create', 'product', info.lastInsertRowid, v.name);
      await integ.notify({ channel: 'log', type: 'product_pending', text: `منتج جديد بانتظار مراجعة الإدارة: ${v.name}` });
      await notifyAdmin(`📦 منتج جديد بانتظار اعتماد الإدارة في منصة Promotion Dizad: ${v.name}`);
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
      db.prepare(`UPDATE products SET category_id=?,name=?,description=?,wholesale_price=?,stock=?,sizes=?,colors=?,images=?,status=?,updated_at=? WHERE id=?`)
        .run(v.category_id, v.name, v.description, v.wholesale_price, v.stock, JSON.stringify(v.sizes), JSON.stringify(v.colors), JSON.stringify(v.images), status, Date.now(), prod.id);
      audit(s.userId, 'product_update', 'product', prod.id, status);
      return send(res, 200, { ok: true, status });
    }
    if (p === '/api/supplier/orders' && req.method === 'GET') {
      const s = requireAuth(req, res, ['supplier']); if (!s) return;
      const rows = db.prepare('SELECT * FROM orders WHERE supplier_id = ? ORDER BY id DESC').all(s.userId).map((o) => ({
        ...o, status_label: ORDER_STATUSES[o.status],
        items: db.prepare('SELECT oi.*, p.name FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?').all(o.id)
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
      await notifyOrderParties(o, `تغيّرت حالة الطلب ${o.ref} إلى: ${ORDER_STATUSES[b.status]}`);
      return send(res, 200, { ok: true });
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
      const rows = db.prepare(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.status = 'approved' ORDER BY p.id DESC`).all()
        .map((r) => ({ ...r, customer_price: customerPrice(r), platform_net: r.platform_margin - r.marketer_commission, images: JSON.parse(r.images), in_stock: r.stock > 0 }));
      return send(res, 200, { products: rows });
    }
    if (p === '/api/marketer/links' && req.method === 'POST') {
      const s = requireAuth(req, res, ['marketer']); if (!s) return;
      const b = await readBody(req);
      const productId = b.productId ? Number(b.productId) : null;
      if (productId && !db.prepare("SELECT id FROM products WHERE id = ? AND status = 'approved'").get(productId))
        return send(res, 400, { error: 'المنتج غير متاح للتسويق' });
      let link = db.prepare('SELECT * FROM referral_links WHERE marketer_id = ? AND product_id IS ?').get(s.userId, productId);
      if (!link) {
        const code = sec.newToken(5);
        const info = db.prepare('INSERT INTO referral_links(code,marketer_id,product_id,created_at) VALUES(?,?,?,?)').run(code, s.userId, productId, Date.now());
        link = db.prepare('SELECT * FROM referral_links WHERE id = ?').get(Number(info.lastInsertRowid));
      }
      return send(res, 201, { ok: true, link: { code: link.code, path: '/r/' + link.code, clicks: link.clicks } });
    }
    if (p === '/api/marketer/links' && req.method === 'GET') {
      const s = requireAuth(req, res, ['marketer']); if (!s) return;
      return send(res, 200, { links: db.prepare('SELECT * FROM referral_links WHERE marketer_id = ? ORDER BY id DESC').all(s.userId) });
    }
    if (p === '/api/marketer/orders' && req.method === 'GET') {
      const s = requireAuth(req, res, ['marketer']); if (!s) return;
      const rows = db.prepare('SELECT id, ref, subtotal, delivery_fee, total, status, created_at FROM orders WHERE marketer_id = ? ORDER BY id DESC').all(s.userId)
        .map((o) => ({ ...o, status_label: ORDER_STATUSES[o.status] }));
      return send(res, 200, { orders: rows });
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
    if (p === '/api/marketer/settlements' && req.method === 'POST') {
      const s = requireAuth(req, res, ['marketer']); if (!s) return;
      const payable = db.prepare("SELECT * FROM commissions WHERE marketer_id = ? AND state = 'payable' AND settlement_id IS NULL").all(s.userId);
      if (!payable.length) return send(res, 400, { error: 'لا توجد عمولات مستحقة قابلة للتسوية حالياً' });
      const amount = payable.reduce((a, c) => a + c.amount, 0);
      db.exec('BEGIN IMMEDIATE');
      try {
        const info = db.prepare(`INSERT INTO settlements(marketer_id,amount,state,created_at,updated_at) VALUES(?,?,'requested',?,?)`).run(s.userId, amount, Date.now(), Date.now());
        const sid = Number(info.lastInsertRowid);
        const upd = db.prepare('UPDATE commissions SET settlement_id = ? WHERE id = ?');
        for (const c of payable) upd.run(sid, c.id);
        db.exec('COMMIT');
        await integ.notify({ channel: 'log', type: 'settlement_request', text: `طلب تسوية جديد #${sid} بمبلغ ${amount} دج من مسوق #${s.userId}` });
        await notifyAdmin(`💰 طلب تسوية عمولات جديد #${sid} بمبلغ ${amount} دج في منصة Promotion Dizad`);
        return send(res, 201, { ok: true, settlementId: sid, amount });
      } catch (e) { db.exec('ROLLBACK'); return send(res, 500, { error: 'خطأ في إنشاء طلب التسوية' }); }
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
        .map((r) => ({ ...r, customer_price: customerPrice(r), platform_net: r.platform_margin - r.marketer_commission, images: JSON.parse(r.images) }));
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
        const margin = Math.round(Number(b.platformMargin));
        const commission = Math.round(Number(b.marketerCommission));
        if (!Number.isFinite(margin) || margin < 0) return send(res, 400, { error: 'هامش المنصة غير صحيح' });
        if (!Number.isFinite(commission) || commission < 0 || commission > margin) return send(res, 400, { error: 'عمولة المسوق يجب أن تكون بين 0 وهامش المنصة' });
        db.prepare("UPDATE products SET status='approved', platform_margin=?, marketer_commission=?, reject_reason=NULL, updated_at=? WHERE id=?")
          .run(margin, commission, Date.now(), prod.id);
        audit(s.userId, 'product_approve', 'product', prod.id, `margin=${margin} commission=${commission}`);
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
    if (p === '/api/admin/orders' && req.method === 'GET') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const rows = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 300').all()
        .map((o) => ({ ...o, status_label: ORDER_STATUSES[o.status] }));
      return send(res, 200, { orders: rows });
    }
    if (p === '/api/admin/settlements' && req.method === 'GET') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const rows = db.prepare(`SELECT st.*, u.name AS marketer_name, u.phone AS marketer_phone FROM settlements st JOIN users u ON u.id = st.marketer_id ORDER BY st.id DESC`).all();
      return send(res, 200, { settlements: rows });
    }
    const settleM = p.match(/^\/api\/admin\/settlements\/(\d+)\/action$/);
    if (settleM && req.method === 'POST') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const st = db.prepare('SELECT * FROM settlements WHERE id = ?').get(Number(settleM[1]));
      if (!st) return send(res, 404, { error: 'طلب التسوية غير موجود' });
      const b = await readBody(req);
      db.exec('BEGIN IMMEDIATE');
      try {
        if (b.action === 'paid') {
          db.prepare("UPDATE settlements SET state='paid', method=?, reference=?, note=?, updated_at=? WHERE id=?")
            .run(b.method || null, b.reference || null, b.note || null, Date.now(), st.id);
          db.prepare("UPDATE commissions SET state='paid', updated_at=? WHERE settlement_id=?").run(Date.now(), st.id);
        } else if (b.action === 'approved') {
          db.prepare("UPDATE settlements SET state='approved', updated_at=? WHERE id=?").run(Date.now(), st.id);
        } else if (b.action === 'rejected') {
          db.prepare("UPDATE settlements SET state='rejected', note=?, updated_at=? WHERE id=?").run(b.note || null, Date.now(), st.id);
          db.prepare('UPDATE commissions SET settlement_id=NULL WHERE settlement_id=?').run(st.id);
        } else throw Object.assign(new Error('إجراء غير معروف'), { http: 400 });
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); return send(res, e.http || 500, { error: e.message }); }
      audit(s.userId, 'settlement_' + b.action, 'settlement', st.id, b.reference || null);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/integrations' && req.method === 'GET') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      return send(res, 200, { integrations: integ.integrationStatus(), statuses: ORDER_STATUSES });
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
    if (p === '/api/admin/backup' && req.method === 'POST') {
      const s = requireAuth(req, res, ['admin']); if (!s) return;
      const fname = `platform-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
      const dest = path.join(DATA_DIR, 'backups', fname).replace(/'/g, '');
      db.exec(`VACUUM INTO '${dest}'`);
      audit(s.userId, 'backup', 'database', fname, null);
      return send(res, 201, { ok: true, file: fname, note: 'نسخة احتياطية كاملة من قاعدة البيانات في مجلد data/backups على الخادم' });
    }

    // ---------- ملفات ثابتة ----------
    if (req.method === 'GET') {
      let file = p === '/' ? path.join(PUBLIC, 'index.html') : path.join(PUBLIC, p);
      if (p.startsWith('/uploads/')) file = path.join(UPLOADS, path.basename(p));
      if (!file.startsWith(PUBLIC) && !file.startsWith(UPLOADS)) return send(res, 403, { error: 'forbidden' });
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ext = path.extname(file).toLowerCase();
        const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        return res.end(fs.readFileSync(file));
      }
    }
    return send(res, 404, { error: 'غير موجود' });
  } catch (e) {
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
  }
  return { name, wholesale_price: wholesale, stock, images, sizes, colors, category_id, description: String(b.description || '').slice(0, 5000) };
}

function changeOrderStatus(o, newStatus, actorId, note, reason, force = false) {
  if (!ORDER_STATUSES[newStatus]) return { error: 'حالة غير معروفة' };
  const allowed = TRANSITIONS[o.status] || [];
  if (!force && !allowed.includes(newStatus)) return { error: `لا يمكن الانتقال من «${ORDER_STATUSES[o.status]}» إلى «${ORDER_STATUSES[newStatus]}»` };
  if ((newStatus === 'rejected' || newStatus === 'cancelled') && o.status === 'pending_supplier' && !reason && !note)
    return { error: 'اذكر سبب الرفض أو الإلغاء' };
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
    }
    if (negative) {
      const cm = db.prepare('SELECT * FROM commissions WHERE order_id = ?').get(o.id);
      if (cm && ['expected', 'confirmed', 'payable'].includes(cm.state)) {
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
  server.listen(PORT, () => console.log(`Promotion Dizad platform running on http://localhost:${PORT}`));
}
module.exports = { server, ORDER_STATUSES };
