'use strict';
// إعادة تصنيف كل المنتجات لأقسام حقيقية حسب الاسم (src/categories-map.js).
// الاستعمال: DATA_DIR=... DB_PATH=... node scripts/recategorize.js [--dry]
// ينشئ الأقسام الناقصة، يحدّث category_id لكل منتج، ويطبع تقرير التوزيع قبل/بعد.
const { db } = require('../src/db');
const { categorize } = require('../src/categories-map');

const dry = process.argv.includes('--dry');
const before = db.prepare('SELECT c.name, COUNT(*) n FROM products p LEFT JOIN categories c ON c.id = p.category_id GROUP BY c.name').all();
console.log('قبل:', before.map((r) => `${r.name || '(بلا)'}: ${r.n}`).join(' · '));

const getCat = db.prepare('SELECT id FROM categories WHERE name = ?');
const insCat = db.prepare('INSERT INTO categories(name, created_at) VALUES(?, ?)');
function catId(name) {
  const r = getCat.get(name);
  if (r) return r.id;
  return Number(insCat.run(name, Date.now()).lastInsertRowid);
}
const products = db.prepare('SELECT id, name, category_id FROM products').all();
const dist = {};
let changed = 0;
db.exec('BEGIN IMMEDIATE');
try {
  for (const p of products) {
    const target = categorize(p.name);
    dist[target] = (dist[target] || 0) + 1;
    const tid = catId(target);
    if (tid !== p.category_id) { changed++; if (!dry) db.prepare('UPDATE products SET category_id = ? WHERE id = ?').run(tid, p.id); }
  }
  db.exec(dry ? 'ROLLBACK' : 'COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }
console.log(`منتجات: ${products.length} — غُيّر قسمها: ${changed}${dry ? ' (تجريبي — لم يُحفظ)' : ''}`);
console.log('بعد:', Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(' · '));
// أقسام فارغة متبقية (للعلم — حذفها من لوحة الإدارة ← أدوات)
const empty = db.prepare('SELECT name FROM categories WHERE id NOT IN (SELECT DISTINCT category_id FROM products WHERE category_id IS NOT NULL)').all();
if (empty.length) console.log('أقسام بلا منتجات:', empty.map((r) => r.name).join('، '));
