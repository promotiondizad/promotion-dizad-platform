// اختبارات آلية شاملة — تشغيل: npm test
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = 4199, BASE = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-test-'));
const dbPath = path.join(tmp, 'test.db');
let passed = 0, failed = 0;
function ok(cond, name) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ فشل: ' + name); } }

const srv = spawn('node', ['src/server.js'], {
  cwd: path.join(import.meta.dirname, '..'),
  env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, DATA_DIR: tmp, TELEGRAM_BOT_TOKEN: '', WHATSAPP_TOKEN: '', WHATSAPP_PHONE_NUMBER_ID: '', FACEBOOK_PAGE_ACCESS_TOKEN: '', ADMIN_TELEGRAM_CHAT_ID: '', AUTH_CODE_OUTBOX_FILE: path.join(tmp, 'outbox.jsonl') },
  stdio: 'pipe'
});
srv.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
async function waitUp() {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(BASE + '/api/wilayas'); if (r.ok) return; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  throw new Error('server did not start');
}
class Client {
  constructor() { this.cookie = ''; this.csrf = null; }
  async req(method, p, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.cookie) headers.Cookie = this.cookie;
    if (this.csrf && method !== 'GET') headers['x-csrf'] = this.csrf;
    const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const data = await res.json().catch(() => ({}));
    if (data.csrf) this.csrf = data.csrf;
    return { status: res.status, data, headers: res.headers };
  }
  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b || {}); }
  put(p, b) { return this.req('PUT', p, b || {}); }
}
const outboxPath = path.join(tmp, 'outbox.jsonl');
function lastOutboxCode(type, target) {
  let lines = [];
  try { lines = fs.readFileSync(outboxPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return null; }
  const es = lines.filter((e) => e.type === type && (target === undefined || e.target === target));
  if (!es.length) return null;
  const m = String(es[es.length - 1].text || '').match(/(\d{6})/);
  return m ? m[1] : null;
}

try {
  await waitUp();
  console.log('— الولايات والتصنيفات —');
  const anon = new Client();
  const w = await anon.get('/api/wilayas');
  ok(w.data.wilayas.length === 58, '58 ولاية محملة');

  console.log('— الإعداد والتسجيل والصلاحيات —');
  let r = await anon.post('/api/setup', { name: 'المدير', phone: '0600000001', password: 'adminpass123' });
  ok(r.status === 201, 'إنشاء المدير الأول');
  r = await anon.post('/api/setup', { name: 'x', phone: '0600000999', password: 'adminpass123' });
  ok(r.status === 403, 'منع إنشاء مدير ثانٍ');
  const admin = new Client();
  r = await admin.post('/api/auth/login', { phone: '0600000001', password: 'adminpass123' });
  ok(r.status === 200 && r.data.user.role === 'admin', 'دخول المدير');

  const supplier = new Client();
  r = await supplier.post('/api/auth/register', { role: 'supplier', name: 'مورد تجريبي', phone: '0600000002', password: 'supplier123', passwordConfirm: 'supplier123', terms: true, activity: 'أجهزة كهرومنزلية', businessName: 'متجر التجربة' });
  ok(r.status === 201 && r.data.status === 'pending', 'تسجيل مورد بحالة انتظار المراجعة');
  r = await supplier.post('/api/auth/register', { role: 'supplier', name: 'مكرر', phone: '0600000002', password: 'supplier123', passwordConfirm: 'supplier123', terms: true, activity: 'x' });
  ok(r.status === 409, 'رفض تكرار رقم الهاتف');
  r = await supplier.post('/api/auth/register', { role: 'buyer', name: 'ضعيف', phone: '0600000010', password: '123', passwordConfirm: '123', terms: true });
  ok(r.status === 400, 'رفض كلمة مرور ضعيفة');
  r = await supplier.post('/api/auth/login', { phone: '0600000002', password: 'supplier123' });
  ok(r.status === 200, 'دخول المورد (الحساب pending)');
  r = await supplier.post('/api/supplier/products', { name: 'منتج مبكر', wholesalePrice: 1000, stock: 5 });
  ok(r.status === 403, 'المورد غير المفعّل لا ينشر منتجات');

  const marketer = new Client();
  r = await marketer.post('/api/auth/register', { role: 'marketer', name: 'مسوق تجريبي', phone: '0600000003', password: 'marketer123', passwordConfirm: 'marketer123', terms: true, wilaya: 16 });
  ok(r.status === 201, 'تسجيل مسوق مفعّل فوراً');
  await marketer.post('/api/auth/login', { phone: '0600000003', password: 'marketer123' });
  const buyer = new Client();
  r = await buyer.post('/api/auth/register', { role: 'buyer', name: 'مشتري تجريبي', phone: '0600000004', password: 'buyer12345', passwordConfirm: 'buyer12345', terms: true });
  ok(r.status === 201, 'تسجيل مشتري');
  await buyer.post('/api/auth/login', { phone: '0600000004', password: 'buyer12345' });

  console.log('— فصل الصلاحيات —');
  r = await marketer.get('/api/supplier/orders');
  ok(r.status === 403, 'المسوق ممنوع من لوحة المورد');
  r = await buyer.get('/api/admin/overview');
  ok(r.status === 403, 'المشتري ممنوع من لوحة الإدارة');
  r = await new Client().get('/api/my/orders');
  ok(r.status === 401, 'الزائر ممنوع من طلبات المشتري');

  console.log('— تفعيل المورد والمنتج والمثال الحسابي الرسمي —');
  const users = await admin.get('/api/admin/users?role=supplier');
  const supId = users.data.users[0].id;
  r = await admin.post(`/api/admin/users/${supId}/action`, { action: 'approve' });
  ok(r.status === 200, 'الإدارة تفعّل المورد');
  await supplier.post('/api/auth/login', { phone: '0600000002', password: 'supplier123' });
  r = await supplier.put('/api/supplier/coverage', { coverage: [{ wilaya_code: 16, delivery_fee: 500 }, { wilaya_code: 35, delivery_fee: 700 }] });
  ok(r.status === 200, 'المورد يضبط تغطية التوصيل');
  r = await supplier.post('/api/supplier/products', { name: 'منتج المثال', description: 'للاختبار', wholesalePrice: 3000, stock: 10 });
  ok(r.status === 201, 'المورد يضيف منتجاً (ينتظر الاعتماد)');
  const prodId = r.data.id;
  let pub = await anon.get('/api/products');
  ok(pub.data.products.length === 0, 'المنتج غير المعتمد لا يظهر للزبائن');
  r = await admin.post(`/api/admin/products/${prodId}/review`, { action: 'approve', platformMargin: 500 });
  ok(r.status === 200, 'الإدارة تعتمد المنتج بهامش 500 (العمولة حرة كيما سوقلي)');
  pub = await anon.get('/api/products');
  ok(pub.data.products.length === 1 && pub.data.products[0].customer_price === 3500, 'السعر الأساسي = 3000 + 500 = 3500');
  ok(pub.data.products[0].wholesale_price === undefined && pub.data.products[0].platform_margin === undefined, 'الواجهة العامة لا تكشف الجملة ولا الهامش');
  r = await admin.post(`/api/admin/products/${prodId}/review`, { action: 'approve', platformMargin: -5 });
  ok(r.status === 400, 'رفض هامش سالب');

  console.log('— الطلب اليدوي والعمولة (بلا روابط إحالة) —');
  r = await marketer.post('/api/marketer/links', { productId: prodId });
  ok(r.status === 404, 'روابط الإحالة محذوفة نهائياً — التسويق يدوي فقط');
  const guest = new Client();
  const orderBody = { customer: { name: 'زبون ضيف', phone: '0600000011', wilaya: 16, commune: 'باب الزوار', address: 'حي تجريبي' }, items: [{ productId: prodId, qty: 1, sellPrice: 3675 }], idempotencyKey: 'test-key-1' };
  r = await marketer.post('/api/orders', orderBody);
  ok(r.status === 201 && r.data.orders[0].total === 4175, 'إجمالي طلب المسوق اليدوي = سعره 3675 + توصيل 500 = 4175');
  const orderRef = r.data.orders[0].ref;
  r = await marketer.post('/api/orders', orderBody);
  ok(r.status === 200 && r.data.duplicate === true, 'منع تكرار الطلب بنفس مفتاح عدم التكرار');
  let supOrders = await supplier.get('/api/supplier/orders');
  ok(supOrders.data.orders.length === 1, 'الطلب وُجّه للمورد الصحيح مرة واحدة فقط');
  const oid = supOrders.data.orders[0].id;
  let prodNow = await anon.get('/api/products/' + prodId);
  ok(prodNow.data.product.stock === 9, 'المخزون نقص بوحدة واحدة فقط رغم إعادة الإرسال');
  let comm = await marketer.get('/api/marketer/commissions');
  ok(comm.data.sums.expected === 175 && comm.data.sums.payable === 0, 'عمولة المسوق من سعره = 3675 − 3500 = 175 متوقعة فقط — غير مستحقة قبل التسليم');

  console.log('— snapshot الأسعار —');
  r = await supplier.put('/api/supplier/products/' + prodId, { name: 'منتج المثال', wholesalePrice: 9000, stock: 9, description: 'للاختبار' });
  ok(r.status === 200 && r.data.status === 'pending_review', 'تغيير سعر الجملة يعيد المنتج للمراجعة');
  await admin.post(`/api/admin/products/${prodId}/review`, { action: 'approve', platformMargin: 500 });
  const track = await anon.get(`/api/orders/track?ref=${orderRef}&phone=0600000011`);
  ok(track.status === 200 && track.data.order.total === 4175, 'الطلب القديم احتفظ بسعره الأصلي 4175 بعد تغيير الأسعار');

  console.log('— حالات الطلب واستحقاق العمولة —');
  r = await supplier.post(`/api/supplier/orders/${oid}/status`, { status: 'preparing' });
  ok(r.status === 400, 'منع قفز الحالات (جديد ← تجهيز مباشرة)');
  for (const st of ['confirmed', 'preparing', 'handed', 'out_for_delivery']) {
    r = await supplier.post(`/api/supplier/orders/${oid}/status`, { status: st });
    if (r.status !== 200) break;
  }
  ok(r.status === 200, 'تسلسل الحالات حتى خرج للتوصيل');
  r = await supplier.post(`/api/supplier/orders/${oid}/status`, { status: 'delivered_collected' });
  ok(r.status === 200, 'التسليم والتحصيل');
  comm = await marketer.get('/api/marketer/commissions');
  ok(comm.data.sums.payable === 175, 'العمولة أصبحت مستحقة 175 بعد التسليم والتحصيل فقط');
  const ov = await admin.get('/api/admin/overview');
  ok(ov.data.platformEarned === 500, 'صافي المنصة المثبت = هامش 500 كاملاً (عمولة المسوق من سعره لا من الهامش)');

  console.log('— الدفع الموثّق بلا طلبات تسوية —');
  r = await marketer.post('/api/marketer/settlements', {});
  ok(r.status === 404, 'لا توجد طلبات تسوية إطلاقاً (المسار أُزيل)');
  const mkUsers = await admin.get('/api/admin/users?role=marketer');
  const mkMe = await marketer.get('/api/me');
  const mkRow = mkUsers.data.users.find((u) => u.id === mkMe.data.user.id) || mkUsers.data.users[0];
  let admSt = await admin.get('/api/admin/settlements');
  const payRow = admSt.data.payable.find((x) => x.marketer_id === mkRow.id);
  ok(payRow && payRow.total === 175, 'مستحقات المسوق القابلة للدفع = 175 بلا أي طلب منه');
  r = await admin.post('/api/admin/payments/confirm', { marketerId: mkRow.id, method: 'تحويل البريد الجاري' });
  ok(r.status === 400, 'توثيق دفع CCP بلا مرجع مرفوض');
  r = await admin.post('/api/admin/payments/confirm', { marketerId: mkRow.id, method: 'تحويل البريد الجاري', reference: 'REF-TEST-1' });
  ok(r.status === 201 && r.data.amount === 175, 'الإدارة توثّق دفعاً فعلياً حدث خارج المنصة بطريقته ومرجعه');
  comm = await marketer.get('/api/marketer/commissions');
  ok(comm.data.sums.paid === 175 && comm.data.settlements[0] && comm.data.settlements[0].state === 'paid' && comm.data.settlements[0].method === 'تحويل البريد الجاري' && comm.data.settlements[0].reference === 'REF-TEST-1', 'العمولة مدفوعة وموثقة عند المسوق بالطريقة والمرجع');
  r = await admin.post('/api/admin/payments/confirm', { marketerId: mkRow.id, method: 'Flexy', reference: 'FX-2' });
  ok(r.status === 400, 'لا دفع ثانٍ بلا رصيد قابل للدفع');
  admSt = await admin.get('/api/admin/settlements');
  ok(admSt.data.payments.length === 1 && admSt.data.payments[0].reference === 'REF-TEST-1', 'سجل المدفوعات الموثقة عند الإدارة يحمل المرجع');

  console.log('— الإلغاء يعيد المخزون ويلغي العمولة —');
  r = await marketer.post('/api/orders', { customer: { name: 'زبون ثانٍ', phone: '0600000012', wilaya: 16, commune: 'درارية', address: 'عنوان' }, items: [{ productId: prodId, qty: 2, sellPrice: 10000 }], idempotencyKey: 'test-key-2' });
  ok(r.status === 201, 'طلب ثانٍ بكمية 2');
  supOrders = await supplier.get('/api/supplier/orders');
  const o2 = supOrders.data.orders.find((o) => o.ref === r.data.orders[0].ref);
  prodNow = await anon.get('/api/products/' + prodId);
  const stockBefore = prodNow.data.product.stock;
  r = await supplier.post(`/api/supplier/orders/${o2.id}/status`, { status: 'rejected', reason: 'رقم لا يرد' });
  ok(r.status === 200, 'المورد يرفض الطلب مع سبب');
  prodNow = await anon.get('/api/products/' + prodId);
  ok(prodNow.data.product.stock === stockBefore + 2, 'المخزون أُعيد بعد الرفض');
  comm = await marketer.get('/api/marketer/commissions');
  ok(comm.data.commissions.find((c) => c.order_id === o2.id).state === 'cancelled', 'عمولة الطلب المرفوض أُلغيت');

  console.log('— ولاية غير مغطاة —');
  r = await guest.post('/api/orders', { customer: { name: 'زبون', phone: '0600000013', wilaya: 1, commune: 'أدرار', address: 'عنوان' }, items: [{ productId: prodId, qty: 1 }], idempotencyKey: 'test-key-3' });
  ok(r.status === 400, 'رفض الطلب لولاية لا يغطيها المورد');

  console.log('— قفل الدخول واستعادة كلمة المرور —');
  const lock = new Client();
  for (let i = 0; i < 5; i++) await lock.post('/api/auth/login', { phone: '0600000004', password: 'wrongpass' });
  r = await lock.post('/api/auth/login', { phone: '0600000004', password: 'buyer12345' });
  ok(r.status === 423, 'قفل الحساب بعد 5 محاولات فاشلة حتى بكلمة مرور صحيحة');
  // فكّ القفل مباشرة من القاعدة لمحاكاة مرور 15 دقيقة، ثم الاستعادة
  const db = new DatabaseSync(dbPath);
  db.prepare('UPDATE users SET locked_until = 0, failed_logins = 0 WHERE phone = ?').run('0600000004');
  r = await lock.post('/api/auth/forgot', { phone: '0600000004' });
  ok(r.status === 200, 'طلب استعادة كلمة المرور');
  const resetRow = db.prepare('SELECT token FROM password_resets ORDER BY id DESC LIMIT 1').get();
  ok(resetRow.token === '', 'توكن الاستعادة لا يُخزَّن نصياً أبداً (تجزئة فقط — تدقيق 2026-10-25)');
  const buyerCode = lastOutboxCode('password_reset', '0600000004');
  r = await lock.post('/api/auth/reset', { phone: '0600000004', code: buyerCode, password: 'newbuyer123', passwordConfirm: 'newbuyer123' });
  ok(r.status === 200, 'تغيير كلمة المرور بالرمز');
  r = await lock.post('/api/auth/login', { phone: '0600000004', password: 'newbuyer123' });
  ok(r.status === 200, 'الدخول بكلمة المرور الجديدة');
  const hashRow = db.prepare('SELECT password_hash FROM users WHERE phone = ?').get('0600000004');
  ok(hashRow.password_hash.startsWith('scrypt:') && !hashRow.password_hash.includes('newbuyer123'), 'كلمة المرور مخزنة بتجزئة scrypt لا كنص مكشوف');

  console.log('— التكاملات والنسخ الاحتياطي —');
  const ig = await admin.get('/api/admin/integrations');
  ok(ig.data.integrations.telegram.configured === false, 'تيليغرام يظهر غير مضبوط بصدق (بلا توكن)');
  ok(typeof ig.data.integrations.whatsapp.note === 'string' && ig.data.integrations.whatsapp.note.length > 10, 'حالة واتساب موثقة مع تنبيه الرسوم');
  const notifs = await admin.get('/api/admin/notifications');
  ok(notifs.data.notifications.some((n) => n.status === 'queued_not_configured'), 'إشعارات الطلبات في الطابور بحالة غير مضبوط — لا ادعاء إرسال كاذب');
  r = await admin.post('/api/admin/integrations/telegram', { token: 'not-a-token' });
  ok(r.status === 400, 'توكن بوت بصيغة خاطئة مرفوض');
  r = await admin.post('/api/admin/integrations/telegram', { token: '123456789:AAEhBOweik6ad9r_QXMENQJUYoJpOfoTest', chatId: '8575879347' });
  ok(r.status === 200, 'المدير يحفظ توكن البوت ومعرّف المحادثة من واجهة الإدارة');
  const ig2 = await admin.get('/api/admin/integrations');
  ok(ig2.data.integrations.telegram.configured === true && ig2.data.integrations.telegram.chatId === '8575879347' && !JSON.stringify(ig2.data.integrations.telegram).includes('AAEhBO'), 'التيليغرام مضبوط من القاعدة والتوكن لا يُعرض أبداً');
  r = await admin.post('/api/admin/integrations/telegram/test', {});
  ok(r.status === 200 && typeof r.data.ok === 'boolean', 'اختبار البوت يرد بنتيجة صريحة');
  r = await admin.post('/api/admin/backup', {});
  ok(r.status === 201 && fs.existsSync(path.join(tmp, 'backups', r.data.file)), 'نسخة احتياطية من قاعدة البيانات تُنشأ فعلاً');

  console.log('— رفع الصور —');
  const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  r = await supplier.post('/api/upload', { dataUrl: px });
  ok(r.status === 201 && r.data.url.startsWith('/uploads/'), 'المورد يرفع صورة منتج من جهازه');
  const img = await fetch(BASE + r.data.url);
  ok(img.status === 200, 'الصورة المرفوعة تُعرض من الخادم');

  console.log('— تتبع الطلبات —');
  r = await anon.get(`/api/orders/track?ref=${orderRef}&phone=0699999999`);
  ok(r.status === 404, 'تتبع برقم هاتف خاطئ مرفوض');
  r = await anon.get(`/api/orders/track?ref=${orderRef}&phone=0600000011`);
  ok(r.status === 200 && Array.isArray(r.data.items) && r.data.items.length === 1, 'التتبع العام يعرض منتجات الطلب');
  ok(r.data.order.stage === 5 && r.data.history.length >= 6, 'التتبع يعرض المرحلة النهائية والسجل الزمني الكامل');
  ok(r.data.order.wilaya_name === 'الجزائر', 'التتبع يعرض اسم ولاية الوجهة');
  await buyer.post('/api/auth/login', { phone: '0600000004', password: 'newbuyer123' });
  r = await buyer.post('/api/orders', { customer: { name: 'مشتري تجريبي', phone: '0600000004', wilaya: 16, commune: 'الشراقة', address: 'عنوان المشتري' }, items: [{ productId: prodId, qty: 1 }], idempotencyKey: 'test-key-buyer-1' });
  ok(r.status === 201, 'المشتري المسجل ينشئ طلباً مرتبطاً بحسابه');
  const myOrders = await buyer.get('/api/my/orders');
  const myOrder = myOrders.data.orders.find((o) => o.ref === r.data.orders[0].ref);
  r = await buyer.get(`/api/orders/${myOrder.id}/timeline`);
  ok(r.status === 200 && r.data.history.length >= 1 && r.data.order.guest_phone === '0600000004', 'صاحب الطلب يرى سجله الزمني الكامل');
  r = await marketer.get(`/api/orders/${myOrder.id}/timeline`);
  ok(r.status === 404, 'مسوق غير معني بالطلب لا يرى سجله الزمني');
  r = await new Client().get(`/api/orders/${myOrder.id}/timeline`);
  ok(r.status === 401, 'الزائر ممنوع من السجل الزمني');

  console.log('— الدخول المباشر واستعادة كلمة المرور بالرمز —');
  const mkMail = new Client();
  r = await mkMail.post('/api/auth/register', { role: 'marketer', name: 'مسوق بالبريد', phone: '0600000021', email: 'mk1@test.dz', password: 'mkpass1234', passwordConfirm: 'mkpass1234', terms: true });
  ok(r.status === 201 && r.data.verificationRequired === undefined, 'التسجيل بالبريد لا يتطلب أي تأكيد (بقرار صاحب المنصة)');
  r = await mkMail.post('/api/auth/login', { phone: '0600000021', password: 'mkpass1234' });
  ok(r.status === 200, 'الدخول مباشرة بعد التسجيل دون أي رمز تأكيد');
  r = await mkMail.post('/api/auth/verify-email', { phone: '0600000021', code: '123456' });
  ok(r.status === 404, 'نقطة تأكيد الحساب محذوفة نهائياً');

  const mk2 = new Client();
  r = await mk2.post('/api/auth/register', { role: 'marketer', name: 'مسوق ثان', phone: '0600000022', email: 'mk2@test.dz', password: 'mkpass1234', passwordConfirm: 'mkpass1234', terms: true });
  ok(r.status === 201, 'تسجيل المسوق الثاني');
  r = await mk2.post('/api/auth/login', { phone: '0600000022', password: 'mkpass1234' });
  ok(r.status === 200, 'دخول المسوق الثاني مباشرة');

  r = await mkMail.post('/api/auth/forgot', { email: 'mk1@test.dz' });
  ok(r.status === 200, 'طلب استعادة بالبريد');
  const rcode = lastOutboxCode('password_reset', 'mk1@test.dz');
  ok(!!rcode, 'رمز الاستعادة وصل بالبريد');
  r = await mkMail.post('/api/auth/reset', { email: 'mk1@test.dz', code: rcode, password: 'mknewpass99', passwordConfirm: 'mknewpass99' });
  ok(r.status === 200, 'تغيير كلمة المرور برمز البريد');
  r = await mkMail.post('/api/auth/login', { phone: '0600000021', password: 'mkpass1234' });
  ok(r.status === 401, 'كلمة المرور القديمة لم تعد تعمل');
  r = await mkMail.post('/api/auth/login', { phone: '0600000021', password: 'mknewpass99' });
  ok(r.status === 200, 'الدخول بكلمة المرور الجديدة');

  r = await mk2.post('/api/auth/forgot', { phone: '0600000022' });
  ok(r.status === 200, 'طلب استعادة برقم الهاتف');
  const pcode = lastOutboxCode('password_reset', '0600000022');
  ok(!!pcode, 'رمز الاستعادة وصل عبر قناة الهاتف');
  r = await mk2.post('/api/auth/reset', { phone: '0600000022', code: pcode, password: 'mk2newpass9', passwordConfirm: 'mk2newpass9' });
  ok(r.status === 200, 'تغيير كلمة المرور برمز الهاتف');
  r = await mk2.post('/api/auth/login', { phone: '0600000022', password: 'mk2newpass9' });
  ok(r.status === 200, 'الدخول بعد استعادة الهاتف');

  const mk3 = new Client();
  r = await mk3.post('/api/auth/register', { role: 'marketer', name: 'مسوق ثالث', phone: '0600000023', email: 'mk3@test.dz', password: 'mkpass1234', passwordConfirm: 'mkpass1234', terms: true });
  r = await mk3.post('/api/auth/login', { phone: '0600000023', password: 'mkpass1234' });
  ok(r.status === 200, 'الحساب الثالث يدخل مباشرة دون تأكيد');

  console.log('— تفاصيل الطلبية الكاملة —');
  r = await admin.get(`/api/orders/${myOrder.id}/details`);
  ok(r.status === 200 && r.data.order.wholesale_total !== undefined && r.data.items[0].platform_margin !== undefined && r.data.order.buyer_name !== undefined, 'المدير يرى تفاصيل الطلبية كاملة بالأرقام الداخلية');
  r = await buyer.get(`/api/orders/${myOrder.id}/details`);
  ok(r.status === 200 && r.data.items[0].wholesale_price === undefined && r.data.order.buyer_phone === '0600000004', 'المشتري يرى تفاصيل طلبية دون أسعار الجملة');
  r = await marketer.get(`/api/orders/${myOrder.id}/details`);
  ok(r.status === 404, 'مسوق غير معني لا يرى تفاصيل الطلبية');
  const admOrders = await admin.get('/api/admin/orders');
  const guestOrder = admOrders.data.orders.find((o) => o.ref === orderRef);
  r = await marketer.get(`/api/orders/${guestOrder.id}/details`);
  ok(r.status === 200 && r.data.order.commission_total === 175 && r.data.order.buyer_phone === '0600000011', 'المسوق المعني يرى عمولته وبيانات زبونه الذي أدخله بنفسه (تدقيق 2026-10-25)');
  r = await anon.get(`/api/orders/${myOrder.id}/details`);
  ok(r.status === 401, 'الزائر ممنوع من تفاصيل الطلبية');
  r = await buyer.get(`/api/orders/${myOrder.id}/details`);
  ok(r.data.items[0].product_id === prodId, 'تفاصيل الطلبية تحمل معرّف المنتج (لإعادة الطلب)');

  console.log('— إعدادات الحساب والتسهيلات —');
  r = await admin.req('PATCH', '/api/me', { name: 'المدير العام' });
  ok(r.status === 200 && r.data.user.name === 'المدير العام', 'تعديل بيانات الحساب من اللوحة');
  r = await mkMail.post('/api/me/password', { currentPassword: 'wrong-old', password: 'mkfinalpass1', passwordConfirm: 'mkfinalpass1' });
  ok(r.status === 401, 'تغيير كلمة المرور يرفض الحالية الخاطئة');
  r = await mkMail.post('/api/me/password', { currentPassword: 'mknewpass99', password: 'mkfinalpass1', passwordConfirm: 'mkfinalpass1' });
  ok(r.status === 200, 'تغيير كلمة المرور من داخل الحساب');
  r = await mkMail.get('/api/me');
  ok(r.status === 200 && r.data.user && r.data.user.phone === '0600000021', 'الجلسة الحالية تبقى صالحة بعد تغيير كلمة المرور');
  r = await new Client().post('/api/auth/login', { phone: '0600000021', password: 'mkfinalpass1' });
  ok(r.status === 200, 'الدخول بكلمة المرور المعدّلة من الإعدادات');
  r = await mk3.req('PATCH', '/api/me', { email: 'mk3new@test.dz' });
  ok(r.status === 200 && r.data.user.email === 'mk3new@test.dz', 'تغيير البريد يتم مباشرة دون تأكيد');
  r = await new Client().post('/api/auth/login', { phone: '0600000023', password: 'mkpass1234' });
  ok(r.status === 200, 'الدخول يعمل مباشرة بعد تغيير البريد');
  r = await anon.get('/api/products?sort=price_asc');
  ok(r.status === 200 && r.data.products.length >= 1, 'ترتيب المنتجات بالسعر يعمل');
  const ascPrices = (await anon.get('/api/products?sort=price_asc')).data.products.map((p) => p.customer_price);
  ok(ascPrices.every((v, i, a) => i === 0 || a[i - 1] <= v), 'الأسعار مرتبة تصاعدياً فعلاً');

  console.log('— مطابقة سوقلي: إشعارات داخلية وأسعار توصيل ومعلومات الدفع —');
  r = await mkMail.req('PATCH', '/api/me', { paymentMethod: 'تحويل بريدي موب', paymentDetails: '0021456789' });
  ok(r.status === 200 && r.data.user.payment_method === 'تحويل بريدي موب' && r.data.user.payment_details === '0021456789', 'المسوق يحفظ معلومات دفع أرباحه');
  r = await mkMail.get('/api/my/notifications');
  ok(r.status === 200 && r.data.notifications.length >= 1 && r.data.notifications.every((n) => typeof n.text === 'string'), 'الإشعارات الداخلية تعرض سجل المستخدم نفسه');
  r = await anon.get('/api/my/notifications');
  ok(r.status === 401, 'الزائر ممنوع من الإشعارات الداخلية');
  r = await anon.get('/api/delivery-coverage');
  ok(r.status === 200 && r.data.coverage.some((c) => c.wilaya_code === 16 && c.min_fee === 500 && c.suppliers >= 1), 'صفحة أسعار التوصيل تعرض أرخص رسم لكل ولاية');
  r = await anon.get('/api/products');
  ok(r.data.products.find((p) => p.id === prodId).sold >= 1, 'بطاقة المنتج تعرض عدد مرات البيع');
  await marketer.req('PATCH', '/api/me', { paymentMethod: 'تحويل البريد الجاري', paymentDetails: '3030303030' });
  const admSettlements = await admin.get('/api/admin/settlements');
  ok(Array.isArray(admSettlements.data.payable) && Array.isArray(admSettlements.data.payments), 'واجهة مدفوعات المدير: مستحقات قابلة للدفع + سجل موثّق');

  console.log('— نموذج سوقلي: عمولة حرة ومحفظة ودعوات وتوصيل مكتب وصفحة متجر —');
  const baseNow = (await anon.get('/api/products/' + prodId)).data.product.customer_price;
  // المسوق يبيع بسعره: أقل من الحد الأدنى (الأساسي + 5%) مرفوض
  r = await marketer.post('/api/orders', { customer: { name: 'زبون مسوق', phone: '0600000041', wilaya: 16, commune: 'حسين داي', address: 'عنوان' }, items: [{ productId: prodId, qty: 1, sellPrice: baseNow + 100 }], idempotencyKey: 'test-key-mk-low' });
  ok(r.status === 400, 'سعر بيع أقل من الحد الأدنى (5%) مرفوض');
  r = await marketer.post('/api/orders', { customer: { name: 'زبون مسوق', phone: '0600000041', wilaya: 16, commune: 'حسين داي', address: 'عنوان' }, items: [{ productId: prodId, qty: 1, sellPrice: baseNow + 500 }], idempotencyKey: 'test-key-mk-1' });
  ok(r.status === 201 && r.data.orders[0].total === baseNow + 500 + 500, 'المسوق يبيع بسعره الحر: الإجمالي = سعره + التوصيل');
  let wallet = await marketer.get('/api/my/wallet');
  ok(wallet.status === 200 && wallet.data.wallet.waiting >= 500, 'محفظة المسوق: عمولة حرة 500 في «قيد الانتظار»');
  ok(wallet.data.wallet.paid === 175, 'محفظة المسوق: المدفوع 175 من طلبه اليدوي السابق');
  // توصيل للمكتب بسعره الخاص
  r = await supplier.put('/api/supplier/coverage', { coverage: [{ wilaya_code: 16, delivery_fee: 500, fee_office: 300, duration: '24-48 ساعة' }, { wilaya_code: 35, delivery_fee: 700 }] });
  ok(r.status === 200, 'المورد يضبط سعر المكتب والمدة');
  r = await anon.get('/api/delivery-coverage');
  ok(r.data.coverage.some((c) => c.wilaya_code === 16 && c.min_office_fee === 300 && c.duration === '24-48 ساعة'), 'صفحة أسعار التوصيل تعرض سعر المكتب والمدة');
  r = await guest.post('/api/orders', { customer: { name: 'زبون مكتب', phone: '0600000042', wilaya: 16, commune: 'الدار البيضاء', address: 'مكتب', deliveryType: 'office' }, items: [{ productId: prodId, qty: 1 }], idempotencyKey: 'test-key-office' });
  ok(r.status === 201 && r.data.orders[0].delivery_fee === 300 && r.data.orders[0].total === baseNow + 300, 'طلب توصيل للمكتب يُحسب بسعر المكتب');
  // صفحة متجر المورد العامة
  r = await anon.get(`/api/suppliers/${supId}/public`);
  ok(r.status === 200 && r.data.supplier.id === supId && r.data.products.length >= 1, 'صفحة متجر المورد العامة تعرض منتجاته');
  ok(r.data.products[0].wholesale_price === undefined, 'صفحة المتجر لا تكشف أسعار الجملة');
  // سعر قبل التخفيض (شارة الخصم كيما النموذج)
  r = await supplier.post('/api/supplier/products', { name: 'منتج بخصم', description: 'اختبار خصم', wholesalePrice: 2000, stock: 5, comparePrice: 4000 });
  ok(r.status === 201, 'المورد يضيف منتجاً بسعر قبل التخفيض');
  const discId = r.data.id;
  await admin.post(`/api/admin/products/${discId}/review`, { action: 'approve', platformMargin: 500 });
  const discPub = await anon.get('/api/products/' + discId);
  ok(discPub.data.product.customer_price === 2500 && discPub.data.product.compare_price === 4000, 'السعر النهائي 2500 والسعر قبل التخفيض 4000 يظهران معاً');
  // الدعوات: المدعو يربح 5000+ فتذهب 500 للداعي
  const inv = await marketer.get('/api/my/invite');
  ok(inv.status === 200 && !!inv.data.code, 'المسوق يحصل على رمز دعوة');
  const invitee = new Client();
  r = await invitee.post('/api/auth/register', { role: 'marketer', name: 'مسوق مدعو', phone: '0600000043', password: 'invitee123', passwordConfirm: 'invitee123', terms: true, inviteCode: inv.data.code });
  ok(r.status === 201, 'التسجيل برمز دعوة');
  await invitee.post('/api/auth/login', { phone: '0600000043', password: 'invitee123' });
  r = await invitee.post('/api/orders', { customer: { name: 'زبون المدعو', phone: '0600000044', wilaya: 16, commune: 'برج الكيفان', address: 'عنوان' }, items: [{ productId: prodId, qty: 1, sellPrice: baseNow + 5500 }], idempotencyKey: 'test-key-inv-1' });
  ok(r.status === 201, 'المدعو يبيع بربح 5500');
  const invOrders = await supplier.get('/api/supplier/orders');
  const invOrder = invOrders.data.orders.find((o) => o.ref === r.data.orders[0].ref);
  for (const st of ['confirmed', 'preparing', 'handed', 'out_for_delivery', 'delivered_collected']) {
    r = await supplier.post(`/api/supplier/orders/${invOrder.id}/status`, { status: st });
    if (r.status !== 200) break;
  }
  ok(r.status === 200, 'طلب المدعو يصل للتسليم والتحصيل');
  const invAfter = await marketer.get('/api/my/invite');
  ok(invAfter.data.bonusesEarned === 500 && invAfter.data.invitedCount === 1, 'الداعي ربح مكافأة الدعوة 500 دج');
  wallet = await marketer.get('/api/my/wallet');
  ok(wallet.data.wallet.balance >= 500 && wallet.data.wallet.bonuses === 500, 'مكافأة الدعوة دخلت رصيد الداعي القابل للسحب');

  console.log('— هوية SOUQAR وتطبيق الويب القابل للتثبيت (PWA) —');
  const manRes = await fetch(BASE + '/manifest.json');
  const manJson = await manRes.json().catch(() => ({}));
  ok(manRes.status === 200 && String(manJson.name || '').includes('SOUQAR'), 'بيان التطبيق يخدم باسم SOUQAR');
  const swRes = await fetch(BASE + '/sw.js');
  ok(swRes.status === 200, 'عامل الخدمة (Service Worker) يخدم');
  const icoRes = await fetch(BASE + '/icons/icon-512.png');
  ok(icoRes.status === 200, 'أيقونة التطبيق 512 تخدم');
  const homeHtml = await (await fetch(BASE + '/')).text();
  ok(homeHtml.includes('SOUQAR') && homeHtml.includes('manifest.json') && homeHtml.includes('سوق واحد'), 'الصفحة الرئيسية بهوية SOUQAR الخضراء وتربط بيان التطبيق');

  console.log('— البلديات الحقيقية —');
  r = await anon.get('/api/communes?wilaya=16');
  ok(r.status === 200 && r.data.communes.length > 40 && r.data.communes.some((c) => c.ar.includes('الجزائر الوسطى')), 'بلديات العاصمة قائمة حقيقية فيها الجزائر الوسطى');
  r = await anon.get('/api/communes?wilaya=31');
  ok(r.status === 200 && r.data.communes.some((c) => c.ar.includes('وهران')), 'بلديات وهران فيها وهران');
  r = await anon.get('/api/communes');
  ok(r.status === 400, 'طلب البلديات بلا ولاية مرفوض');

  console.log('— واجهة الإدارة المنفصلة —');
  const admPage = await fetch(BASE + '/admin.html');
  const admHtml = await admPage.text();
  ok(admPage.status === 200 && admHtml.includes('واجهة إدارة'), 'واجهة الإدارة متاحة في صفحتها المنفصلة /admin.html');
  const pubJs = await (await fetch(BASE + '/app.js')).text();
  ok(!pubJs.includes('renderAdmin') && !pubJs.includes('/api/admin/overview'), 'التطبيق العام لا يحتوي أي كود لواجهة الإدارة');


  console.log('— تقييمات المنتجات: للمشترين المستلمين فقط —');
  r = await supplier.post('/api/supplier/products', { name: 'منتج التقييم', description: 'للمراجعات', wholesalePrice: 1000, stock: 5 });
  ok(r.status === 201, 'منتج التقييم أُضيف');
  const rvProdId = r.data.id;
  r = await admin.post(`/api/admin/products/${rvProdId}/review`, { action: 'approve', platformMargin: 200 });
  ok(r.status === 200, 'منتج التقييم اعتُمد (سعر أساسي 1200)');
  const stranger = new Client();
  r = await stranger.post('/api/auth/register', { role: 'buyer', name: 'غريب', phone: '0600000051', password: 'stranger123', passwordConfirm: 'stranger123', terms: true });
  await stranger.post('/api/auth/login', { phone: '0600000051', password: 'stranger123' });
  r = await stranger.post(`/api/products/${rvProdId}/reviews`, { stars: 5, comment: 'رائع' });
  ok(r.status === 403, 'التقييم ممنوع قبل الشراء والاستلام');
  const rvBuyer = new Client();
  r = await rvBuyer.post('/api/auth/register', { role: 'buyer', name: 'مشتري مقيم', phone: '0600000052', password: 'rvbuyer123', passwordConfirm: 'rvbuyer123', terms: true });
  await rvBuyer.post('/api/auth/login', { phone: '0600000052', password: 'rvbuyer123' });
  r = await rvBuyer.post('/api/orders', { customer: { name: 'مشتري مقيم', phone: '0600000052', wilaya: 16, commune: 'باب الزوار', address: 'حي 1' }, items: [{ productId: rvProdId, qty: 1 }], idempotencyKey: 'test-key-rev-1' });
  ok(r.status === 201, 'طلب المشتري المقيم أُنشئ');
  const rvRef = r.data.orders[0].ref;
  const supOrdersRv = await supplier.get('/api/supplier/orders');
  const rvOrderId = supOrdersRv.data.orders.find((o) => o.ref === rvRef).id;
  for (const st of ['confirmed', 'preparing', 'handed', 'out_for_delivery', 'delivered_collected']) {
    r = await supplier.post(`/api/supplier/orders/${rvOrderId}/status`, { status: st });
    if (r.status !== 200) break;
  }
  ok(r.status === 200, 'طلب المقيم وصل للتسليم');
  r = await rvBuyer.post(`/api/products/${rvProdId}/reviews`, { stars: 5, comment: 'منتج ممتاز' });
  ok(r.status === 200 && r.data.rating_count === 1, 'تقييم المستلم يُقبل ويُحتسب');
  r = await rvBuyer.post(`/api/products/${rvProdId}/reviews`, { stars: 3, comment: 'جيد' });
  ok(r.status === 200 && Math.abs(r.data.rating_avg - 3) < 0.01 && r.data.rating_count === 1, 'تحديث التقييم يستبدل ولا يضاعف');
  r = await anon.get(`/api/products/${rvProdId}`);
  ok(r.data.product.rating_count === 1 && Array.isArray(r.data.product.reviews) && r.data.product.reviews.length === 1, 'التفاصيل تعرض التقييمات');
  r = await rvBuyer.post(`/api/products/${rvProdId}/reviews`, { stars: 9 });
  ok(r.status === 400, 'نجوم خارج النطاق تُرفض');


  console.log('— متابعة المورّدين —');
  const supList = await admin.get('/api/admin/users?role=supplier');
  const supIdMain = supList.data.users[0].id;
  const fol0 = await anon.get(`/api/suppliers/${supIdMain}/follow`);
  ok(fol0.status === 200 && fol0.data.followers === 0 && fol0.data.following === false, 'عدّاد المتابعين يبدأ من الصفر');
  r = await stranger.post(`/api/suppliers/${supIdMain}/follow`, {});
  ok(r.status === 200 && r.data.following === true && r.data.followers === 1, 'المتابعة تُسجَّل والعدّاد يرتفع');
  r = await stranger.post(`/api/suppliers/${supIdMain}/follow`, {});
  ok(r.status === 200 && r.data.following === false && r.data.followers === 0, 'إعادة الضغط تلغي المتابعة');
  r = await anon.post(`/api/suppliers/${supIdMain}/follow`, {});
  ok(r.status === 401, 'الزائر لا يتابع دون دخول');


  console.log('— إشعارات الطلبات الغنية (مشتري + منتج + عمولة) —');
  {
    const lines = fs.readFileSync(outboxPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const updates = lines.filter((e) => e.type === 'order_update').map((e) => String(e.text || ''));
    const supDigest = updates.find((x) => x.includes('مشتري مقيم') && x.includes('0600000052'));
    ok(!!supDigest && supDigest.includes('منتج التقييم') && supDigest.includes('الإجمالي') && supDigest.includes('🛒 طلب جديد'), 'إشعار المورد يحمل اسم المشتري ورقمه والمنتج والإجمالي');
    const commMsg = updates.find((x) => x.includes('عمولتك') && x.includes('أصبحت موافقاً عليها'));
    ok(!!commMsg, 'المسوق يصله إشعار عمولته عند التسليم والتحصيل');
  }


  console.log('— صفحة المتجر: تقييمات وبيانات موسعة —');
  {
    const pub = await anon.get(`/api/suppliers/${supIdMain}/public`);
    ok(pub.status === 200 && pub.data.supplier.rating_count >= 1 && typeof pub.data.supplier.coverage_count === 'number' && Array.isArray(pub.data.supplier.reviews), 'صفحة المتجر تعرض ملخص التقييمات وعدد ولايات التغطية');
  }

  console.log('— إصلاحات تدقيق 2026-10-25 —');
  {
    // مخزون وفير لطلبات هذا القسم (تعديل مخزون فقط بنفس الاسم والسعر — لا يعيد المراجعة... وإن أعادها نعتمد من جديد)
    await supplier.put('/api/supplier/products/' + prodId, { name: 'منتج المثال', wholesalePrice: 9000, stock: 60, description: 'للاختبار' });
    await admin.post(`/api/admin/products/${prodId}/review`, { action: 'approve', platformMargin: 500 });
    // مورد ثانٍ لاختبار السلة المختلطة
    const supB = new Client();
    r = await supB.post('/api/auth/register', { role: 'supplier', name: 'مورد ب', phone: '0600000031', password: 'supplier123', passwordConfirm: 'supplier123', terms: true, activity: 'عام', businessName: 'متجر ب' });
    const supBRow = (await admin.get('/api/admin/users?role=supplier')).data.users.find((u) => u.phone === '0600000031');
    await admin.post(`/api/admin/users/${supBRow.id}/action`, { action: 'approve' });
    await supB.post('/api/auth/login', { phone: '0600000031', password: 'supplier123' });
    await supB.put('/api/supplier/coverage', { coverage: [{ wilaya_code: 16, delivery_fee: 400 }] });
    r = await supB.post('/api/supplier/products', { name: 'منتج المورد ب', wholesalePrice: 2000, stock: 5 });
    const prodB = r.data.id;
    await admin.post(`/api/admin/products/${prodB}/review`, { action: 'approve', platformMargin: 300 });

    // سلة مختلطة: منتج من موردين ← طلبيتان لا خطأ 500، والتكرار لا يضاعف الأرقام
    const splitBody = { customer: { name: 'زبون مختلط', phone: '0600000032', wilaya: 16, commune: 'باب الزوار', address: 'حي' }, items: [{ productId: prodId, qty: 1 }, { productId: prodB, qty: 1 }], idempotencyKey: 'audit-split-1' };
    r = await anon.post('/api/orders', splitBody);
    ok(r.status === 201 && r.data.orders.length === 2, 'سلة متعددة الموردين تنشئ طلبيتين (إصلاح انهيار 500)');
    r = await anon.post('/api/orders', splitBody);
    ok(r.status === 200 && r.data.duplicate === true && r.data.orders.length === 2, 'إعادة الإرسال: duplicate يعرض كل طلب مرة واحدة');

    // CSRF على النقاط المعدِّلة كلها
    const mkRaw = new Client();
    await mkRaw.post('/api/auth/login', { phone: '0600000003', password: 'marketer123' });
    mkRaw.csrf = null;
    r = await mkRaw.req('PATCH', '/api/me', { paymentDetails: 'CSRF-PROBE' });
    ok(r.status === 403, 'PATCH /api/me بلا CSRF ← 403');
    const meProbe = await marketer.get('/api/me');
    ok(meProbe.data.user.payment_details !== 'CSRF-PROBE', 'تفاصيل الدفع لم تُخترق');
    r = await mkRaw.post('/api/me/password', { currentPassword: 'marketer123', password: 'newpass12345', passwordConfirm: 'newpass12345' });
    ok(r.status === 403, 'تغيير كلمة المرور بلا CSRF ← 403');
    r = await mkRaw.post('/api/orders', { customer: { name: 'x', phone: '0600000032', wilaya: 16, commune: 'باب الزوار', address: 'حي' }, items: [{ productId: prodId, qty: 1 }] });
    ok(r.status === 403, 'إنشاء طلب بجلسة بلا CSRF ← 403');

    // تحقق الإعدادات
    r = await marketer.req('PATCH', '/api/me', { paymentMethod: 'Bitcoin' });
    ok(r.status === 400, 'وسيلة دفع خارج القائمة ← 400');
    r = await marketer.req('PATCH', '/api/me', { wilaya: 999 });
    ok(r.status === 400, 'ولاية 999 ← 400');
    r = await marketer.req('PATCH', '/api/me', { wilaya: 16, commune: 'حاسي مسعود' });
    ok(r.status === 400, 'بلدية لا تنتمي للولاية ← 400');

    // لا هوامش في طلبات المورد
    const soA = await supplier.get('/api/supplier/orders');
    const itA = (soA.data.orders[0] || {}).items || [];
    ok(itA.length > 0 && !('platform_margin' in itA[0]) && !('marketer_commission' in itA[0]), 'أصناف طلبات المورد بلا هامش منصة ولا عمولة مسوق');

    // تغطية فاسدة لا تمسح السليمة
    const covCountBefore = (await supB.get('/api/supplier/coverage')).data.coverage.length;
    r = await supB.put('/api/supplier/coverage', { coverage: [{ wilaya_code: 99, delivery_fee: 100 }] });
    ok(r.status === 400, 'تغطية بولاية 99 ← 400');
    ok((await supB.get('/api/supplier/coverage')).data.coverage.length === covCountBefore, 'التغطية السليمة لم تُمسح');

    // رفع صورة مزيفة
    r = await supplier.post('/api/upload', { dataUrl: 'data:image/png;base64,' + Buffer.from('not an image').toString('base64') });
    ok(r.status === 400, 'رفع «صورة» مزيفة (نص) ← 400');

    // JSON فاسد ← 400 لا 500
    const rawBad = await fetch(BASE + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    ok(rawBad.status === 400, 'JSON فاسد ← 400');

    // المسوق يرى بيانات زبونه هو — ومسوق آخر لا يرى الطلب أصلاً
    const mkOrders1 = await marketer.get('/api/marketer/orders');
    const ownOrder = mkOrders1.data.orders[0];
    const det = await marketer.get('/api/orders/' + ownOrder.id + '/details');
    ok(det.status === 200 && !!det.data.order.buyer_phone, 'المسوق يرى هاتف زبونه في طلبه');
    const mkOther = new Client();
    await mkOther.post('/api/auth/register', { role: 'marketer', name: 'مسوق آخر', phone: '0600000033', password: 'marketer123', passwordConfirm: 'marketer123', terms: true });
    await mkOther.post('/api/auth/login', { phone: '0600000033', password: 'marketer123' });
    r = await mkOther.get('/api/orders/' + ownOrder.id + '/details');
    ok(r.status === 404, 'مسوق آخر لا يصل لطلب غيره ← 404');

    // عمولة جديدة قابلة للسحب لدورة طلب السحب
    const prodNow2 = await anon.get('/api/products/' + prodId);
    const baseNow = prodNow2.data.product.customer_price;
    const mkOrder = { customer: { name: 'زبون سحب', phone: '0600000034', wilaya: 16, commune: 'باب الزوار', address: 'حي' }, items: [{ productId: prodId, qty: 1, sellPrice: baseNow + 500 }], idempotencyKey: 'audit-payout-1' };
    r = await marketer.post('/api/orders', mkOrder);
    ok(r.status === 201, 'طلب مسوق جديد لدورة السحب');
    const supOrdersNow = await supplier.get('/api/supplier/orders');
    const poId = supOrdersNow.data.orders.find((o) => o.ref === r.data.orders[0].ref).id;
    for (const st of ['confirmed', 'preparing', 'handed', 'out_for_delivery', 'delivered_collected']) await supplier.post(`/api/supplier/orders/${poId}/status`, { status: st });
    let wal = (await marketer.get('/api/my/wallet')).data.wallet;
    const balBefore = wal.balance - 500;
    ok(wal.balance === balBefore + 500 && balBefore >= 0, 'رصيد قابل للسحب ازداد 500 بعد التسليم (فيه مكوّنات سابقة كالدعوات)');
    r = await marketer.post('/api/my/payout-requests', { amount: 99999, method: 'Flexy', details: '0661111111' });
    ok(r.status === 400, 'طلب سحب أكبر من الرصيد ← 400');
    r = await marketer.post('/api/my/payout-requests', { amount: 500, method: 'Flexy', details: '0661111111' });
    ok(r.status === 201 && r.data.amount === 500, 'طلب سحب صحيح ← 201');
    wal = (await marketer.get('/api/my/wallet')).data.wallet;
    ok(wal.balance === balBefore && wal.requested === 500, 'المحفظة: 500 قيد السحب والمتاح عاد لما قبل الطلب الجديد');
    r = await marketer.post('/api/my/payout-requests', { amount: 100, method: 'Flexy', details: '0661111111' });
    ok(r.status === 409, 'طلب سحب ثانٍ أثناء معلّق ← 409');
    const prId = (await marketer.get('/api/my/payout-requests')).data.requests.find((x) => x.state === 'pending').id;
    let admS = await admin.get('/api/admin/settlements');
    ok(admS.data.payoutRequests.some((x) => x.id === prId && x.state === 'pending'), 'الإدارة ترى طلب السحب معلّقاً');
    const directRow = admS.data.payable.find((x) => x.marketer_id === mkMe.data.user.id);
    ok(!directRow || directRow.total === balBefore, 'الدفع المباشر يعرض فقط غير المرتبط بطلب سحب');
    r = await admin.post(`/api/admin/payout-requests/${prId}/confirm`, { method: 'Flexy' });
    ok(r.status === 400, 'تأكيد سحب Flexy بلا مرجع ← 400');
    r = await admin.post(`/api/admin/payout-requests/${prId}/confirm`, { method: 'Flexy', reference: 'FX-TEST-9' });
    ok(r.status === 201 && r.data.amount === 500, 'الإدارة تؤكد دفع طلب السحب بالمرجع');
    wal = (await marketer.get('/api/my/wallet')).data.wallet;
    ok(wal.requested === 0 && wal.paid >= 500, 'بعد دفع الطلب: مدفوع ارتفع وقيد السحب صفر');
    const myReqs = await marketer.get('/api/my/payout-requests');
    ok(myReqs.data.requests.find((x) => x.id === prId).state === 'paid', 'المسوق يرى طلبه مدفوعاً');

    // رفض طلب يحرّر العمولات
    r = await marketer.post('/api/orders', { ...mkOrder, idempotencyKey: 'audit-payout-2', items: [{ productId: prodId, qty: 1, sellPrice: baseNow + 600 }] });
    const po2Ref = r.data.orders[0].ref;
    const po2Id = (await supplier.get('/api/supplier/orders')).data.orders.find((o) => o.ref === po2Ref).id;
    for (const st of ['confirmed', 'preparing', 'handed', 'out_for_delivery', 'delivered_collected']) await supplier.post(`/api/supplier/orders/${po2Id}/status`, { status: st });
    r = await marketer.post('/api/my/payout-requests', { amount: 600, method: 'Flexy', details: '0661111111' });
    const pr2Id = r.data.requestId;
    await admin.post(`/api/admin/payout-requests/${pr2Id}/reject`, { reason: 'تفاصيل ناقصة' });
    wal = (await marketer.get('/api/my/wallet')).data.wallet;
    ok(wal.balance === balBefore + 600 && wal.requested === 0, 'رفض الإدارة يحرّر العمولة للرصيد من جديد');

    // failed_delivery في بلاطة قيد الانتظار
    r = await marketer.post('/api/orders', { ...mkOrder, idempotencyKey: 'audit-fail-1', items: [{ productId: prodId, qty: 1, sellPrice: baseNow + 700 }] });
    const fRef = r.data.orders[0].ref;
    const fId = (await supplier.get('/api/supplier/orders')).data.orders.find((o) => o.ref === fRef).id;
    for (const st of ['confirmed', 'preparing', 'handed', 'out_for_delivery', 'failed_delivery']) await supplier.post(`/api/supplier/orders/${fId}/status`, { status: st });
    wal = (await marketer.get('/api/my/wallet')).data.wallet;
    ok(wal.waiting >= 700, 'عمولة تعذّر التسليم ظاهرة في المحفظة (قيد الانتظار)');

    // إرجاع بعد التسليم قبل الدفع يلغي العمولة — وبعد الدفع ممنوع حتى بقوة الإدارة
    r = await supplier.post(`/api/supplier/orders/${po2Id}/status`, { status: 'returned' });
    ok(r.status === 200, 'إرجاع طلب مسلّم غير مدفوع العمولة مسموح');
    const commAfterRet = await marketer.get('/api/marketer/commissions');
    const retComm = commAfterRet.data.commissions.find((c) => c.order_id === po2Id);
    ok(retComm && retComm.state === 'cancelled', 'عمولة المرتجع بعد التسليم أُلغيت');
    r = await admin.post(`/api/supplier/orders/${oid}/status`, { status: 'cancelled' });
    ok(r.status === 400, 'طلب عمولته مدفوعة لا يُلغى حتى بقوة الإدارة');

    // إشعارات المشتري داخل التطبيق + غير المقروء
    r = await buyer.post('/api/orders', { customer: { name: 'مشتري تجريبي', phone: '0600000004', wilaya: 16, commune: 'باب الزوار', address: 'حي' }, items: [{ productId: prodId, qty: 1 }], idempotencyKey: 'audit-buyer-1' });
    ok(r.status === 201, 'المشتري يطلب من حسابه');
    const bOrderId = (await supplier.get('/api/supplier/orders')).data.orders.find((o) => o.ref === r.data.orders[0].ref).id;
    await supplier.post(`/api/supplier/orders/${bOrderId}/status`, { status: 'confirmed' });
    const bNotif = await buyer.get('/api/my/notifications');
    ok(bNotif.data.notifications.some((n) => n.type === 'order_update'), 'المشتري يتلقى إشعاراً داخل التطبيق عن طلبه');
    ok(bNotif.data.unread >= 1, 'عداد غير المقروء يعمل');
    ok(bNotif.data.notifications.every((n) => !('channel' in n)), 'الجرس بلا سباكة قنوات');
    await buyer.post('/api/my/notifications/read', {});
    ok((await buyer.get('/api/my/notifications')).data.unread === 0, 'تعليم الكل كمقروء');

    // رمز الاستعادة لا يظهر في الجرس
    await anon.post('/api/auth/forgot', { phone: '0600000003' });
    const resetCode = lastOutboxCode('password_reset', '0600000003') || lastOutboxCode('password_reset');
    const mkNotif = await marketer.get('/api/my/notifications');
    const resetEntry = mkNotif.data.notifications.find((n) => n.type === 'password_reset');
    ok(!!resetEntry && (!resetCode || !resetEntry.text.includes(resetCode)), 'رمز الاستعادة غير مكشوف في جرس الإشعارات');

    // حد محاولات الاستعادة
    let saw429 = false;
    for (let i = 0; i < 11 && !saw429; i++) { const rr = await anon.post('/api/auth/forgot', { phone: '0600000099' }); if (rr.status === 429) saw429 = true; }
    ok(saw429, 'حد محاولات /api/auth/forgot يعمل (429)');

    // أقسام: CRUD
    r = await admin.post('/api/admin/categories', { name: 'قسم اختبار' });
    ok(r.status === 201, 'إنشاء قسم');
    const testCatId = r.data.id;
    r = await admin.req('PATCH', `/api/admin/categories/${testCatId}`, { name: 'قسم اختبار معاد' });
    ok(r.status === 200, 'إعادة تسمية قسم');
    const usedCatId = (await anon.get('/api/categories')).data.categories.find((c) => c.name === 'عام').id;
    r = await admin.req('DELETE', `/api/admin/categories/${usedCatId}`);
    ok(r.status === 409, 'حذف قسم فيه منتجات ← 409');
    r = await admin.req('DELETE', `/api/admin/categories/${testCatId}`);
    ok(r.status === 200, 'حذف قسم فارغ');

    // جلسات
    const sessList = await marketer.get('/api/me/sessions');
    ok(sessList.data.sessions.some((x) => x.current), 'قائمة الجلسات تميّز الحالية');
    const curKey = sessList.data.sessions.find((x) => x.current).key;
    r = await marketer.req('DELETE', `/api/me/sessions/${curKey}`);
    ok(r.status === 400, 'إنهاء الجلسة الحالية من القائمة ممنوع');

    // دعم: ردّ وإغلاق + اتصال موثّق + ترتيب + CSV
    await anon.post('/api/support', { name: 'زائر', phone: '0600000035', message: 'سؤال اختبار' });
    const msgs = await admin.get('/api/admin/support');
    const msgId = msgs.data.messages[0].id;
    r = await admin.post(`/api/admin/support/${msgId}/reply`, { text: 'جواب اختبار' });
    ok(r.status === 200, 'الإدارة ترد على رسالة دعم');
    r = await admin.post(`/api/admin/support/${msgId}/close`, {});
    ok(r.status === 200, 'الإدارة تغلق رسالة الدعم');
    r = await supplier.post(`/api/supplier/orders/${bOrderId}/contact`, { result: 'answered' });
    ok(r.status === 201, 'المورد يوثّق اتصالاً بالزبون');
    r = await supplier.post(`/api/supplier/orders/${bOrderId}/contact`, { result: 'bad' });
    ok(r.status === 400, 'نتيجة اتصال غير معروفة ← 400');
    r = await anon.get('/api/products?sort=sold');
    ok(r.status === 200 && Array.isArray(r.data.products), 'ترتيب الأكثر مبيعاً');
    r = await anon.get('/api/products?sort=rating');
    ok(r.status === 200, 'ترتيب الأعلى تقييماً');
    const csvRes = await fetch(BASE + '/api/admin/export/payments.csv', { headers: { Cookie: admin.cookie } });
    const csvText = await csvRes.text();
    ok(csvRes.status === 200 && csvText.includes('REF-TEST-1'), 'تصدير CSV للمدفوعات الموثّقة');
  }

  console.log(`\nالنتيجة: ${passed} ناجحة، ${failed} فاشلة`);
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error('خطأ في الاختبارات:', e);
  process.exitCode = 1;
} finally {
  srv.kill();
}

