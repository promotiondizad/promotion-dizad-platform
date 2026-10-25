'use strict';
// التكاملات الرسمية فقط. لا يُرسل أي شيء فعلياً ما لم تُضبط المفاتيح في أسرار الخادم (env).
// حالة كل تكامل تظهر في لوحة الإدارة بصدق: configured / not_configured + آخر نجاح وفشل.
const { db } = require('./db');
const fs = require('node:fs');
const net = require('node:net');
const tls = require('node:tls');

const CFG = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  whatsappToken: process.env.WHATSAPP_TOKEN || '',
  whatsappPhoneId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  facebookPageToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '',
  facebookPageId: process.env.FACEBOOK_PAGE_ID || 'promotion.dizad',
  storeWhatsapp: process.env.STORE_WHATSAPP || '213791402649'
};

// البريد الإلكتروني عبر SMTP (Gmail بخطوة App Password، أو Brevo المجاني…) — بلا أي اعتماديات خارجية
const SMTP = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || process.env.SMTP_USER || ''
};
function emailConfigured() { return !!(SMTP.host && SMTP.user && SMTP.pass && SMTP.from); }

// إعدادات تحفظها الإدارة في قاعدة البيانات (تنجو من نوم الخادم وتبديل الاستضافة) — تتقدّم على متغيرات البيئة
function getSetting(k) { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? r.value : null; }
function botToken() { return getSetting('telegram_bot_token') || CFG.telegramBotToken || ''; }
function adminChatId() { return getSetting('admin_telegram_chat_id') || process.env.ADMIN_TELEGRAM_CHAT_ID || ''; }

function smtpSend(to, subject, text) {
  return new Promise((resolve, reject) => {
    const secure = SMTP.port === 465;
    const socket = secure
      ? tls.connect({ host: SMTP.host, port: SMTP.port, servername: SMTP.host })
      : net.connect({ host: SMTP.host, port: SMTP.port });
    socket.setTimeout(12000);
    let buf = '', waiters = [];
    const onData = (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (/^\d{3} /.test(line) && waiters.length) waiters.shift()(line);
      }
    };
    socket.on('data', onData);
    socket.on('timeout', () => { socket.destroy(); reject(new Error('SMTP timeout')); });
    socket.on('error', reject);
    const read = () => new Promise((r) => waiters.push(r));
    const send = (s) => socket.write(s + '\r\n');
    (async () => {
      try {
        let line = await read();
        if (!line.startsWith('220')) throw new Error('SMTP greeting: ' + line);
        send('EHLO promotion-dizad'); line = await read();
        if (!secure) {
          if (!/STARTTLS/i.test(line)) { /* قد تصل قدرات الخادم في أسطر متعددة — نتابع */ }
          send('STARTTLS'); line = await read();
          if (!line.startsWith('220')) throw new Error('STARTTLS: ' + line);
          const up = tls.connect({ socket, servername: SMTP.host });
          await new Promise((res2, rej2) => { up.once('secureConnect', res2); up.once('error', rej2); });
          // إعادة ربط القارئ بالمقبس المشفّر
          socket.removeAllListeners('data'); buf = ''; waiters = [];
          up.on('data', onData);
          const sendUp = (s) => up.write(s + '\r\n');
          sendUp('EHLO promotion-dizad'); line = await read();
          return await authAndSend(sendUp, read, up, resolve, reject, line);
        }
        await authAndSend(send, read, socket, resolve, reject, line);
      } catch (e) { try { socket.destroy(); } catch {} reject(e); }
    })();
    async function authAndSend(sendFn, readFn, sock, res, rej, ehloLine) {
      try {
        let line = ehloLine;
        sendFn('AUTH LOGIN'); line = await readFn();
        if (!line.startsWith('334')) throw new Error('AUTH: ' + line);
        sendFn(Buffer.from(SMTP.user).toString('base64')); line = await readFn();
        if (!line.startsWith('334')) throw new Error('AUTH user: ' + line);
        sendFn(Buffer.from(SMTP.pass).toString('base64')); line = await readFn();
        if (!line.startsWith('235')) throw new Error('AUTH pass: ' + line);
        sendFn(`MAIL FROM:<${SMTP.from}>`); line = await readFn();
        if (!line.startsWith('250')) throw new Error('MAIL FROM: ' + line);
        sendFn(`RCPT TO:<${to}>`); line = await readFn();
        if (!line.startsWith('250')) throw new Error('RCPT TO: ' + line);
        sendFn('DATA'); line = await readFn();
        if (!line.startsWith('354')) throw new Error('DATA: ' + line);
        const subj64 = Buffer.from(subject, 'utf8').toString('base64');
        const body64 = Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
        sock.write(`From: SOUQAR <${SMTP.from}>\r\nTo: ${to}\r\nSubject: =?UTF-8?B?${subj64}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${body64}\r\n.\r\n`);
        line = await readFn();
        if (!line.startsWith('250')) throw new Error('BODY: ' + line);
        sendFn('QUIT');
        sock.end();
        res(true);
      } catch (e) { try { sock.destroy(); } catch {} rej(e); }
    }
  });
}

function integrationStatus() {
  const last = (ch) => db.prepare(
    'SELECT status, created_at, sent_at, last_error FROM notifications WHERE channel = ? ORDER BY id DESC LIMIT 1'
  ).get(ch);
  const failed = (ch) => db.prepare(
    "SELECT COUNT(*) c FROM notifications WHERE channel = ? AND status IN ('failed','queued_not_configured')"
  ).get(ch).c;
  return {
    email: {
      configured: emailConfigured(),
      note: emailConfigured() ? `مضبوط — SMTP (${SMTP.host}) لإرسال رموز التأكيد والاستعادة` : 'غير مضبوط: أضف SMTP_HOST وSMTP_USER وSMTP_PASS في أسرار الخادم (Gmail عبر App Password أو Brevo المجاني) — حتى يُضبط، تبقى رموز البريد في الطابور ويمكن للمدير التأكيد يدوياً',
      last: last('email'), failedCount: failed('email')
    },
    telegram: {
      configured: !!botToken(),
      tokenSet: !!botToken(),
      chatId: adminChatId(),
      note: botToken() ? 'بوت مضبوط — الإرسال عبر Telegram Bot API الرسمي' : 'غير مضبوط: احفظ توكن البوت من BotFather في بطاقة الإعداد أسفله',
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
  const res = await fetch(`https://api.telegram.org/bot${botToken()}/sendMessage`, {
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
  // صندوق بريد تطويري اختياري (اختبارات/تشخيص فقط): يُضبط عبر AUTH_CODE_OUTBOX_FILE فتُسجَّل فيه كل الإشعارات
  if (process.env.AUTH_CODE_OUTBOX_FILE) {
    try { fs.appendFileSync(process.env.AUTH_CODE_OUTBOX_FILE, JSON.stringify({ channel, userId, type, target, text, at: Date.now() }) + '\n'); } catch {}
  }
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
      if (!botToken()) throw Object.assign(new Error('telegram_not_configured'), { notConfigured: true });
      const chatId = target || (n.user_id ? (db.prepare('SELECT telegram_chat_id FROM users WHERE id = ?').get(n.user_id) || {}).telegram_chat_id : null);
      if (!chatId) throw Object.assign(new Error('no_telegram_chat_id_for_user'), { notConfigured: true });
      await sendTelegram(chatId, text);
    } else if (n.channel === 'whatsapp') {
      if (!CFG.whatsappToken || !CFG.whatsappPhoneId) throw Object.assign(new Error('whatsapp_not_configured'), { notConfigured: true });
      if (!target) throw Object.assign(new Error('no_whatsapp_target'), { notConfigured: true });
      await sendWhatsapp(target, text);
    } else if (n.channel === 'email') {
      if (!target) throw Object.assign(new Error('no_email_target'), { notConfigured: true });
      if (emailConfigured()) {
        const subjects = { email_verification: 'رمز تأكيد حسابك — SOUQAR', password_reset: 'رمز استعادة كلمة المرور — SOUQAR' };
        await smtpSend(target, subjects[n.type] || 'SOUQAR', text);
      } else if (process.env.AUTH_CODE_OUTBOX_FILE) {
        // وضع التطوير/الاختبار: سُجّل في الصندوق الصادر أعلاه فيُعدّ مُرسلاً إليه
      } else {
        throw Object.assign(new Error('smtp_not_configured'), { notConfigured: true });
      }
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

async function telegramTest() {
  const tok = botToken();
  if (!tok) return { ok: false, error: 'لا يوجد توكن محفوظ بعد' };
  const meRes = await fetch(`https://api.telegram.org/bot${tok}/getMe`, { signal: AbortSignal.timeout(6000) });
  const me = await meRes.json().catch(() => ({}));
  if (!me.ok) return { ok: false, error: 'التوكن مرفوض من تيليغرام — تأكد من نسخه كاملاً من BotFather' };
  const chat = adminChatId();
  if (!chat) return { ok: true, bot: me.result.username, sent: false, error: 'البوت صحيح، لكن معرّف محادثة المدير غير محفوظ بعد' };
  await sendTelegram(chat, '✅ SOUQAR — بوت إشعارات المنصة مربوط ويعمل.');
  return { ok: true, bot: me.result.username, sent: true };
}

module.exports = { CFG, integrationStatus, notify, attemptNotification, emailConfigured, botToken, adminChatId, telegramTest };
