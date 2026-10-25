'use strict';
// التكاملات الرسمية فقط. لا يُرسل أي شيء فعلياً ما لم تُضبط المفاتيح في أسرار الخادم (env).
// حالة كل تكامل تظهر في لوحة الإدارة بصدق: configured / not_configured + آخر نجاح وفشل.
const { db } = require('./db');

const CFG = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  whatsappToken: process.env.WHATSAPP_TOKEN || '',
  whatsappPhoneId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  facebookPageToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '',
  facebookPageId: process.env.FACEBOOK_PAGE_ID || 'promotion.dizad',
  storeWhatsapp: process.env.STORE_WHATSAPP || '213791402649'
};

function integrationStatus() {
  const last = (ch) => db.prepare(
    'SELECT status, created_at, sent_at, last_error FROM notifications WHERE channel = ? ORDER BY id DESC LIMIT 1'
  ).get(ch);
  const failed = (ch) => db.prepare(
    "SELECT COUNT(*) c FROM notifications WHERE channel = ? AND status IN ('failed','queued_not_configured')"
  ).get(ch).c;
  return {
    telegram: {
      configured: !!CFG.telegramBotToken,
      note: CFG.telegramBotToken ? 'بوت مضبوط — الإرسال عبر Telegram Bot API الرسمي' : 'غير مضبوط: أضف TELEGRAM_BOT_TOKEN في أسرار الخادم (من BotFather، مجاني)',
      last: last('telegram'), failedCount: failed('telegram')
    },
    whatsapp: {
      configured: !!(CFG.whatsappToken && CFG.whatsappPhoneId),
      note: (CFG.whatsappToken && CFG.whatsappPhoneId)
        ? 'مضبوط — WhatsApp Business Platform (Meta) الرسمي'
        : 'أزرار واتساب (wa.me) تعمل الآن. الإشعارات الآلية تحتاج WhatsApp Business Platform الرسمي من Meta — قد تنطبق رسوم رسائل حسب Meta، ولا تُفعَّل دون موافقة صاحب المنصة',
      last: last('whatsapp'), failedCount: failed('whatsapp')
    },
    facebook: {
      configured: !!CFG.facebookPageToken,
      note: CFG.facebookPageToken
        ? 'مضبوط — Meta Graph API الرسمي'
        : 'أزرار المشاركة والمراسلة (m.me) تعمل الآن. دمج رسائل الصفحة في لوحة الدعم يحتاج تطبيق Meta وصلاحيات مراجعة — غير مضبوط بعد',
      pageId: CFG.facebookPageId,
      last: last('facebook'), failedCount: failed('facebook')
    }
  };
}

async function sendTelegram(chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${CFG.telegramBotToken}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(5000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error('Telegram: ' + (data.description || res.status));
}
async function sendWhatsapp(to, text) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${CFG.whatsappPhoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CFG.whatsappToken}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    signal: AbortSignal.timeout(5000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('WhatsApp: ' + ((data.error && data.error.message) || res.status));
}

// إنشاء إشعار ومحاولة إرساله فوراً إن كان التكامل مضبوطاً، وإلا يبقى في الطابور بحالة صادقة.
async function notify({ userId = null, channel, type, text, target = null }) {
  const payload = JSON.stringify({ text, target });
  const info = db.prepare('INSERT INTO notifications(user_id,channel,type,payload,status,created_at) VALUES(?,?,?,?,?,?)')
    .run(userId, channel, type, payload, 'queued', Date.now());
  const id = Number(info.lastInsertRowid);
  await attemptNotification(id);
  return id;
}

async function attemptNotification(id) {
  const n = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
  if (!n) return { ok: false, error: 'not_found' };
  const { text, target } = JSON.parse(n.payload || '{}');
  const attempts = n.attempts + 1;
  try {
    if (n.channel === 'telegram') {
      if (!CFG.telegramBotToken) throw Object.assign(new Error('telegram_not_configured'), { notConfigured: true });
      const chatId = target || (n.user_id ? (db.prepare('SELECT telegram_chat_id FROM users WHERE id = ?').get(n.user_id) || {}).telegram_chat_id : null);
      if (!chatId) throw Object.assign(new Error('no_telegram_chat_id_for_user'), { notConfigured: true });
      await sendTelegram(chatId, text);
    } else if (n.channel === 'whatsapp') {
      if (!CFG.whatsappToken || !CFG.whatsappPhoneId) throw Object.assign(new Error('whatsapp_not_configured'), { notConfigured: true });
      if (!target) throw Object.assign(new Error('no_whatsapp_target'), { notConfigured: true });
      await sendWhatsapp(target, text);
    } else if (n.channel === 'log') {
      // قناة داخلية: تُسجَّل فقط (إشعارات الإدارة داخل اللوحة)
    } else {
      throw Object.assign(new Error('channel_not_configured: ' + n.channel), { notConfigured: true });
    }
    db.prepare('UPDATE notifications SET status = ?, attempts = ?, sent_at = ?, last_error = NULL WHERE id = ?')
      .run('sent', attempts, Date.now(), id);
    return { ok: true };
  } catch (e) {
    const status = e.notConfigured ? 'queued_not_configured' : 'failed';
    db.prepare('UPDATE notifications SET status = ?, attempts = ?, last_error = ? WHERE id = ?')
      .run(status, attempts, String(e.message || e).slice(0, 300), id);
    return { ok: false, status, error: String(e.message || e) };
  }
}

module.exports = { CFG, integrationStatus, notify, attemptNotification };
