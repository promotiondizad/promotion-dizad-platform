'use strict';
// قاعدة البيانات — SQLite مدمجة في Node (بلا أي اعتماديات خارجية، مجاني 100%)
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });

const db = new DatabaseSync(process.env.DB_PATH || path.join(DATA_DIR, 'platform.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK(role IN ('admin','supplier','marketer','buyer')),
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  password_hash TEXT NOT NULL,
  wilaya INTEGER,
  commune TEXT,
  address TEXT,
  business_name TEXT,
  activity TEXT,
  telegram_chat_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('pending','active','suspended','rejected')),
  reject_reason TEXT,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wilayas (code INTEGER PRIMARY KEY, name_ar TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS supplier_coverage (
  supplier_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wilaya_code INTEGER NOT NULL REFERENCES wilayas(code),
  delivery_fee INTEGER NOT NULL CHECK(delivery_fee >= 0),
  PRIMARY KEY (supplier_id, wilaya_code)
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER REFERENCES categories(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  wholesale_price INTEGER NOT NULL CHECK(wholesale_price >= 0),
  platform_margin INTEGER NOT NULL DEFAULT 0 CHECK(platform_margin >= 0),
  marketer_commission INTEGER NOT NULL DEFAULT 0 CHECK(marketer_commission >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
  sizes TEXT NOT NULL DEFAULT '[]',
  colors TEXT NOT NULL DEFAULT '[]',
  images TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','approved','rejected','paused')),
  reject_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS referral_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  marketer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  group_ref TEXT,
  buyer_id INTEGER REFERENCES users(id),
  guest_name TEXT, guest_phone TEXT,
  wilaya INTEGER NOT NULL, commune TEXT NOT NULL, address TEXT NOT NULL,
  supplier_id INTEGER NOT NULL REFERENCES users(id),
  marketer_id INTEGER REFERENCES users(id),
  ref_code TEXT,
  subtotal INTEGER NOT NULL, delivery_fee INTEGER NOT NULL, total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_supplier',
  reject_reason TEXT,
  stock_restored INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL CHECK(qty > 0),
  size TEXT, color TEXT,
  wholesale_price INTEGER NOT NULL,
  platform_margin INTEGER NOT NULL,
  marketer_commission INTEGER NOT NULL,
  customer_price INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL, actor_id INTEGER, note TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  marketer_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  platform_amount INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'expected' CHECK(state IN ('expected','confirmed','payable','paid','cancelled')),
  settlement_id INTEGER REFERENCES settlements(id),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketer_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'requested' CHECK(state IN ('requested','approved','paid','rejected')),
  method TEXT, reference TEXT, note TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, channel TEXT NOT NULL, type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT, created_at INTEGER NOT NULL, sent_at INTEGER
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER, action TEXT NOT NULL, entity TEXT, entity_id TEXT, details TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, phone TEXT NOT NULL, message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

const WILAYAS = [
  [1,'أدرار'],[2,'الشلف'],[3,'الأغواط'],[4,'أم البواقي'],[5,'باتنة'],[6,'بجاية'],
  [7,'بسكرة'],[8,'بشار'],[9,'البليدة'],[10,'البويرة'],[11,'تمنراست'],[12,'تبسة'],
  [13,'تلمسان'],[14,'تيارت'],[15,'تيزي وزو'],[16,'الجزائر'],[17,'الجلفة'],[18,'جيجل'],
  [19,'سطيف'],[20,'سعيدة'],[21,'سكيكدة'],[22,'سيدي بلعباس'],[23,'عنابة'],[24,'قالمة'],
  [25,'قسنطينة'],[26,'المدية'],[27,'مستغانم'],[28,'المسيلة'],[29,'معسكر'],[30,'ورقلة'],
  [31,'وهران'],[32,'البيض'],[33,'إليزي'],[34,'برج بوعريريج'],[35,'بومرداس'],[36,'الطارف'],
  [37,'تندوف'],[38,'تيسمسيلت'],[39,'الوادي'],[40,'خنشلة'],[41,'سوق أهراس'],[42,'تيبازة'],
  [43,'ميلة'],[44,'عين الدفلى'],[45,'النعامة'],[46,'عين تموشنت'],[47,'غرداية'],[48,'غليزان'],
  [49,'تيميمون'],[50,'برج باجي مختار'],[51,'أولاد جلال'],[52,'بني عباس'],[53,'عين صالح'],
  [54,'عين قزام'],[55,'تقرت'],[56,'جانت'],[57,'المغير'],[58,'المنيعة']
];
{
  const ins = db.prepare('INSERT OR IGNORE INTO wilayas(code,name_ar) VALUES(?,?)');
  for (const [c, n] of WILAYAS) ins.run(c, n);
  const cat = db.prepare('INSERT OR IGNORE INTO categories(name,created_at) VALUES(?,?)');
  for (const n of ['عام']) cat.run(n, Date.now());
}

// ترقية: تأكيد البريد الإلكتروني ورموز المصادقة (تأكيد الحساب + استعادة كلمة المرور)
try { db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1'); } catch { /* العمود موجود */ }
try { db.exec('ALTER TABLE users ADD COLUMN payment_method TEXT'); } catch { /* العمود موجود */ }
try { db.exec('ALTER TABLE users ADD COLUMN payment_details TEXT'); } catch { /* العمود موجود */ }
db.exec(`CREATE TABLE IF NOT EXISTS auth_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`);

function audit(actorId, action, entity, entityId, details) {
  db.prepare('INSERT INTO audit_logs(actor_id,action,entity,entity_id,details,created_at) VALUES(?,?,?,?,?,?)')
    .run(actorId || null, action, entity || null, entityId ? String(entityId) : null, details || null, Date.now());
}

module.exports = { db, DATA_DIR, audit };
