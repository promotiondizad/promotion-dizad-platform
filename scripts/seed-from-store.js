'use strict';
// استيراد منتجات متجر Promotion Dizad الحالي (store-data.json) إلى منصة SOUQAR
// كمورد «Promotion Dizad» بأسعار المتجر نفسها (الجملة = السعر ÷ 1.1، والهامش = الفرق).
// آمن لإعادة التشغيل: يتخطى المنتجات الموجودة بنفس الاسم عند نفس المورد.
// التشغيل: node scripts/seed-from-store.js [--url <رابط store-data.json>]
const { db } = require('../src/db');
const sec = require('../src/security');

const urlArg = process.argv.indexOf('--url');
const STORE_URL = urlArg > -1 ? process.argv[urlArg + 1] : 'https://sandjerdev-ui.github.io/store-data.json';
// رقم اصطناعي مقصود (ليس رقماً حقيقياً): رقم المتجر 0791402649 هو هاتف حساب المدير نفسه،
// ولا يجوز إعادة استعماله لحساب آخر. حساب المورد هنا حاوية عرض للمنتجات المستوردة،
// وعند الحاجة تُنقل منتجاته لحساب مورد حقيقي بطلب من المؤسس.
const SUPPLIER_PHONE = '0000000000';
const HOME_FEE = 500, OFFICE_FEE = 300, DURATION = '24-72 ساعة', DEFAULT_STOCK = 20;

(async () => {
  const res = await fetch(STORE_URL);
  if (!res.ok) throw new Error('تعذر جلب بيانات المتجر: HTTP ' + res.status);
  const data = await res.json();
  const items = Array.isArray(data.products) ? data.products : [];
  if (!items.length) throw new Error('لا منتجات في بيانات المتجر');
  const now = Date.now();

  let supplier = db.prepare('SELECT * FROM users WHERE phone = ?').get(SUPPLIER_PHONE);
  if (supplier && supplier.role !== 'supplier') throw new Error('الرقم ' + SUPPLIER_PHONE + ' مسجل بدور آخر — أوقف الاستيراد');
  if (!supplier) {
    const info = db.prepare(`INSERT INTO users(role,name,phone,password_hash,business_name,status,created_at)
      VALUES('supplier','Promotion Dizad',?,?,?,'active',?)`)
      .run(SUPPLIER_PHONE, sec.hashPassword('seed-' + Math.random().toString(36).slice(2) + Date.now()), 'متجر Promotion Dizad', now);
    supplier = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    console.log('أُنشئ حساب المورد Promotion Dizad برقم', info.lastInsertRowid);
  } else console.log('مورد Promotion Dizad موجود برقم', supplier.id);

  const { categorize } = require('../src/categories-map');
  const catCache = new Map();
  function catIdFor(name) {
    const cn = categorize(name);
    if (!catCache.has(cn)) {
      let c = db.prepare('SELECT id FROM categories WHERE name = ?').get(cn);
      if (!c) { const r = db.prepare('INSERT INTO categories(name,created_at) VALUES(?,?)').run(cn, now); c = { id: r.lastInsertRowid }; }
      catCache.set(cn, c.id);
    }
    return catCache.get(cn);
  }

  const cov = db.prepare('INSERT OR REPLACE INTO supplier_coverage(supplier_id,wilaya_code,delivery_fee,fee_office,duration) VALUES(?,?,?,?,?)');
  for (let w = 1; w <= 58; w++) cov.run(supplier.id, w, HOME_FEE, OFFICE_FEE, DURATION);

  const exists = db.prepare('SELECT id FROM products WHERE supplier_id = ? AND name = ?');
  const insert = db.prepare(`INSERT INTO products(supplier_id,category_id,name,description,wholesale_price,platform_margin,marketer_commission,stock,sizes,colors,images,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,0,?, '[]','[]',?,'approved',?,?)`);
  let added = 0, skipped = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const p of items) {
      if (p.available === false) { skipped++; continue; }
      const name = String((p.name && (p.name.ar || p.name.fr)) || '').trim();
      const price = Math.round(Number(p.price));
      if (!name || !Number.isFinite(price) || price <= 0) { skipped++; continue; }
      if (exists.get(supplier.id, name)) { skipped++; continue; }
      const wholesale = Math.round(price / 1.1);
      const margin = price - wholesale;
      const tagline = (p.tagline && p.tagline.ar) || '';
      const contents = (p.contents && Array.isArray(p.contents.ar)) ? p.contents.ar : [];
      const desc = [tagline, contents.length ? 'محتويات الباك: ' + contents.join(' • ') : '', p.count && p.count.ar ? 'العدد: ' + p.count.ar : ''].filter(Boolean).join('\n');
      let images = Array.isArray(p.images) ? p.images.filter((x) => typeof x === 'string' && x.startsWith('http')).slice(0, 6) : [];
      if (!images.length && typeof p.image === 'string' && p.image.startsWith('http')) images = [p.image];
      if (!images.length && p.id === 'sw-4074') images = ['/pimg/nutrifresh-mesures.jpg']; // صورتها الأصلية Base64 — تُقدَّم من الخادم
      insert.run(supplier.id, catIdFor(name), name, desc, wholesale, margin, DEFAULT_STOCK, JSON.stringify(images), now, now);
      added++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const total = db.prepare("SELECT COUNT(*) c FROM products WHERE supplier_id = ? AND status = 'approved'").get(supplier.id).c;
  console.log(`تم: أُضيف ${added} منتجاً، تُخطّي ${skipped}. إجمالي منتجات المورد المعتمدة الآن: ${total}`);
  console.log('التغطية: 58 ولاية — منزل', HOME_FEE, 'دج / مكتب', OFFICE_FEE, 'دج (قابلة للتعديل من لوحة المورد)');
})().catch((e) => { console.error('فشل الاستيراد:', e.message); process.exit(1); });
