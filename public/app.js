'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('fr-DZ') + ' دج';
let CSRF = null, ME = null, WILAYAS = [], CATEGORIES = [], PRODUCTS = [];
let CART = JSON.parse(localStorage.getItem('pd_cart') || '[]');
let checkoutKey = sessionStorage.getItem('pd_checkout_key') || null;
let CO_ITEMS = null; // «اشترِ الآن»: مصدر إتمام طلب مؤقت بمنتج واحد — لا يلمس السلة أبداً
// تحديث تلقائي: مقارنة نسخة البناء مع الخادم دورياً — صفحة مفتوحة قديماً لا تبقى عالقة أبداً
const CLIENT_VERSION = 'v2026.10.26-13';
async function checkForUpdate() {
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    const d = await r.json();
    if (d.version && d.version !== CLIENT_VERSION && sessionStorage.getItem('pd_vr') !== d.version) {
      sessionStorage.setItem('pd_vr', d.version);
      toast('وصل تحديث جديد — تُحدَّث الصفحة الآن…');
      setTimeout(() => location.reload(), 700);
    }
  } catch {}
}
setInterval(checkForUpdate, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });

function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  setTimeout(() => { t.hidden = true; }, 4200);
}
// نسخ صادق: يرجع true عند النجاح فعلاً (مع بديل قديم للمتصفحات) — لا رسالة نجاح كاذبة
async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); return true; } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch { return false; }
}
// تحميل صور فعلي (blob) — عند منع CORS يشرح للمستخدم كيف يحفظها من المعرض
async function downloadImages(p) {
  if (!p.images || !p.images.length) return toast('لا صور لهذا المنتج', true);
  let okCount = 0;
  for (let i = 0; i < p.images.length; i++) {
    try {
      const r = await fetch(p.images[i]);
      if (!r.ok) throw new Error('x');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'souqar-' + p.id + '-' + (i + 1) + '.jpg';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      okCount++;
    } catch {}
  }
  if (okCount) toast('حُمّلت ' + okCount + ' صورة — استعملها في إعلاناتك');
  else toast('المتصفح منع التحميل المباشر — افتح المنتج واضغط مطولاً على صوره في المعرض لحفظها', true);
}
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (CSRF && (opts.method || 'GET') !== 'GET') headers['x-csrf'] = CSRF;
  const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || ('خطأ ' + res.status)); e.data = data; e.status = res.status; throw e; }
  return data;
}
// ---------- صلابة الاتصال: فشل نداء واحد لا يقتل التطبيق كله، والفشل يظهر للمستخدم بدل فراغ صامت ----------
const WILAYAS_FALLBACK = [[1, 'أدرار'], [2, 'الشلف'], [3, 'الأغواط'], [4, 'أم البواقي'], [5, 'باتنة'], [6, 'بجاية'], [7, 'بسكرة'], [8, 'بشار'], [9, 'البليدة'], [10, 'البويرة'], [11, 'تمنراست'], [12, 'تبسة'], [13, 'تلمسان'], [14, 'تيارت'], [15, 'تيزي وزو'], [16, 'الجزائر'], [17, 'الجلفة'], [18, 'جيجل'], [19, 'سطيف'], [20, 'سعيدة'], [21, 'سكيكدة'], [22, 'سيدي بلعباس'], [23, 'عنابة'], [24, 'قالمة'], [25, 'قسنطينة'], [26, 'المدية'], [27, 'مستغانم'], [28, 'المسيلة'], [29, 'معسكر'], [30, 'ورقلة'], [31, 'وهران'], [32, 'البيض'], [33, 'إليزي'], [34, 'برج بوعريريج'], [35, 'بومرداس'], [36, 'الطارف'], [37, 'تندوف'], [38, 'تيسمسيلت'], [39, 'الوادي'], [40, 'خنشلة'], [41, 'سوق أهراس'], [42, 'تيبازة'], [43, 'ميلة'], [44, 'عين الدفلى'], [45, 'النعامة'], [46, 'عين تموشنت'], [47, 'غرداية'], [48, 'غليزان'], [49, 'تيميمون'], [50, 'برج باجي مختار'], [51, 'أولاد جلال'], [52, 'بني عباس'], [53, 'عين صالح'], [54, 'عين قزام'], [55, 'تقرت'], [56, 'جانت'], [57, 'المغير'], [58, 'المنيعة']].map(([code, name_ar]) => ({ code, name_ar }));
function setConnError(on) { const b = $('#connBar'); if (b) b.hidden = !on; }
async function tryApi(path, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) { try { return await api(path); } catch (e) { last = e; if (i + 1 < tries) await new Promise((r) => setTimeout(r, 1200)); } }
  throw last;
}
function fillWilayaSelects() {
  for (const sel of ['#coWilaya', '#rgWilaya']) {
    const el = $(sel); if (!el) continue;
    const first = el.querySelector('option'); el.innerHTML = ''; if (first) el.appendChild(first);
    for (const w of WILAYAS) { const o = document.createElement('option'); o.value = w.code; o.textContent = w.code + ' — ' + w.name_ar; el.appendChild(o); }
  }
}
function show(view) {
  for (const v of ['home', 'page', 'auth', 'dash', 'track', 'product', 'checkout']) $('#view-' + v).hidden = v !== view;
  const cd = $('#cartDrawer'); if (cd) cd.hidden = true;
  const ms = $('#moreSheet'); if (ms) ms.hidden = true;
  if (view !== 'checkout') CO_ITEMS = null;
  if (view === 'product' || view === 'checkout') window.scrollTo(0, 0);
  window.scrollTo({ top: 0 });
}

// ---------- تتبع الطلبات ----------
const FLOW_LABELS = ['طلب جديد', 'مؤكد من المورد', 'قيد التجهيز', 'سُلّم لشركة التوصيل', 'خرج للتوصيل', 'تم التسليم والتحصيل'];
const NEGATIVE = { cancelled: 'أُلغي هذا الطلب', rejected: 'رُفض هذا الطلب من المورد', returned: 'رُجع هذا الطلب', failed_delivery: 'تعذر التسليم — المورد يعيد المحاولة أو يرجع الطلب' };
function trackHtml(data) {
  const o = data.order;
  const neg = NEGATIVE[o.status];
  const steps = o.stage >= 0 ? `<div class="steps">${FLOW_LABELS.map((l, i) => `<div class="step ${i < o.stage ? 'done' : ''} ${i === o.stage ? (o.status === 'delivered_collected' ? 'done' : 'now') : ''}">${l}</div>`).join('')}</div>` : '';
  return `<div class="totals" style="margin-top:14px">
    <strong>${esc(o.ref)}</strong> — ${esc(o.status_label)}<br>
    ${o.wilaya_name ? `الوجهة: ${esc(o.wilaya_name)} / ${esc(o.commune || '')}<br>` : ''}${o.commune && !o.wilaya_name ? `البلدية: ${esc(o.commune)}<br>` : ''}
    ${neg ? `<div class="status-banner bad">${neg}${o.reject_reason ? ' — السبب: ' + esc(o.reject_reason) : ''}</div>` : ''}
    ${o.status === 'delivered_collected' ? '<div class="status-banner good">✅ اكتمل الطلب: تم التسليم والتحصيل. شكراً لثقتك!</div>' : ''}
    ${steps}
    <div style="margin-top:8px">${data.items.map((i) => `${esc(i.name)} × ${i.qty}${i.size ? ' · مقاس ' + esc(i.size) : ''}${i.color ? ' · ' + esc(i.color) : ''} — ${fmt(i.customer_price * i.qty)}`).join('<br>')}</div>
    <div style="margin-top:8px">المنتجات: ${fmt(o.subtotal)} · التوصيل: ${fmt(o.delivery_fee)} · <span class="grand">الإجمالي عند الاستلام: ${fmt(o.total)}</span></div>
    <div class="hist">${data.history.map((h) => `<p><span class="t">${new Date(h.created_at).toLocaleString('ar-DZ')}</span><br>${esc(h.label)}${h.note ? ' — ' + esc(h.note) : ''}</p>`).join('')}</div>
  </div>`;
}
async function doTrack(ref, phone, targetEl) {
  const r = await api('/api/orders/track?ref=' + encodeURIComponent(ref) + '&phone=' + encodeURIComponent(phone));
  targetEl.innerHTML = trackHtml(r);
  return r;
}
async function openTrack() {
  show('track');
  const card = $('#ttMineCard'), box = $('#ttMine');
  if (!ME) { card.hidden = true; return; }
  try {
    let orders = [];
    if (ME.role === 'buyer') orders = (await api('/api/my/orders')).orders;
    else if (ME.role === 'marketer') orders = (await api('/api/marketer/orders')).orders;
    else if (ME.role === 'supplier') orders = (await api('/api/supplier/orders')).orders;
    else if (ME.role === 'admin') orders = (await api('/api/admin/orders')).orders;
    card.hidden = false;
    box.innerHTML = orders.length ? orders.slice(0, 30).map((o) => `
      <p><strong>${esc(o.ref)}</strong> — ${esc(o.status_label || STATUS_AR[o.status] || o.status)} — ${fmt(o.total)} — ${new Date(o.created_at).toLocaleDateString('ar-DZ')}
      <button class="btn small light" data-tl="${o.id}">السجل الزمني</button></p>
      <div id="tl-${o.id}"></div>`).join('') : '<p class="muted">لا توجد طلبات مرتبطة بحسابك بعد.</p>';
    $$('#ttMine [data-tl]').forEach((b) => b.addEventListener('click', async () => {
      const el = $('#tl-' + b.dataset.tl);
      if (el.innerHTML) { el.innerHTML = ''; return; }
      try { const r = await api(`/api/orders/${b.dataset.tl}/timeline`); el.innerHTML = trackHtml(r); }
      catch (e) { toast(e.message, true); }
    }));
  } catch { card.hidden = true; }
}

// ---------- صفحات ثابتة ----------
const PAGES = {
  terms: `<h2>الشروط والأحكام</h2>
  <h3>قواعد التسويق والعمولات</h3>
  <ul>
    <li>التسويق في المنصة <strong>يدوي فقط — لا توجد روابط إحالة</strong>: المسوق يسوّق المنتجات بنفسه (بالوصف والصور المتاحين في لوحته) ويُدخل طلبات زبائنه بنفسه من حسابه.</li>
    <li>عمولة المسوق <strong>حسب اختياره</strong>: لكل منتج سعر أساسي معروض، والمسوق يحدد سعر بيعه للزبون عند إدخال الطلب — ربحه هو الفرق بين سعر بيعه والسعر الأساسي، بشرط ألا يقل الربح عن 5% من السعر الأساسي.</li>
    <li>العمولة «متوقعة» عند إنشاء الطلب، وتمر بحالات: قيد الانتظار ← في التوصيل ← موافق عليها (بعد «تم التسليم والتحصيل») ← مدفوعة. الطلبات الملغاة أو المرتجعة أو المتعذرة <strong>لا تولّد أرباحاً نهائية</strong> وتُلغى عمولاتها آلياً.</li>
    <li>الدفع: من محفظة المسوق يقدّم <strong>طلب سحب أرباح</strong> بوسيلة استلامه المسجّلة (تحويل بريدي موب، تحويل البريد الجاري، Flexy، ظرف بريدي، أو الاستلام من مقر المنصة) — الدفع الفعلي يتم خارج المنصة، وتوثّقه الإدارة في المنصة بطريقته ومرجعه فتتحول العمولات المرتبطة إلى «مدفوعة».</li>
    <li>برنامج «ادعو أصدقائك»: عندما تبلغ الأرباح الموافق عليها لمسوق انضم بدعوتك 5000 دج، تربح مكافأة 500 دج تُضاف إلى رصيدك القابل للدفع.</li>
  </ul>
  <h3>الموردون</h3>
  <ul>
    <li>حساب المورد يُراجَع ويُفعَّل من الإدارة قبل النشر. المورد مسؤول عن صحة الأسعار والمخزون والأوصاف والصور، وعن تجهيز الطلبات المؤكدة وتسليمها لشركة توصيله.</li>
    <li>لا يظهر أي منتج نافد المخزون على أنه متوفر. رفع منتجات مقلدة أو مضللة يعرض الحساب للإيقاف.</li>
  </ul>
  <h3>المشترون</h3>
  <ul><li>الدفع عند الاستلام. الأسعار والتوصيل تظهر كاملة قبل التأكيد — لا تكاليف مخفية.</li>
  <li>يمكن إلغاء الطلب من حسابك ما دام جديداً لم يؤكده المورد بعد.</li></ul>
  <h3>حدود مسؤولية المنصة</h3>
  <p>المنصة وسيط تنظيمي وتقني: لا تشتري المخزون، لا تستلم أموال الزبائن، ولا تدير شركات التوصيل. أي اتفاق مالي أو تشغيلي إضافي يُوثَّق كتابة بين أطرافه.</p>`,
  privacy: `<h2>سياسة الخصوصية</h2>
  <ul>
    <li>نخزّن فقط البيانات اللازمة: الاسم، الهاتف، الولاية/البلدية/العنوان عند الطلب، وبيانات الحساب والطلبات والعمولات.</li>
    <li>كلمات المرور مخزنة بتجزئة آمنة (scrypt) ولا يمكن قراءتها كنص.</li>
    <li>بيانات المشتري (الهاتف والعنوان) لا تظهر إلا للمورد المسؤول عن طلبه وللإدارة — ولا تُرسل في إشعارات عامة.</li>
    <li>لا نبيع بيانات المستخدمين ولا نشاركها مع أطراف ثالثة خارج تشغيل الطلب (المورد وشركة توصيله).</li>
    <li>لكل مستخدم رؤية طلباته وبياناته فقط — فصل الصلاحيات مطبق في الخادم.</li>
  </ul>`,
  faq: `<h2>الأسئلة الشائعة</h2>
  <h3>كيفاش نربح كمسوق؟</h3>
  <p>اختر منتجاً من الكتالوج، انسخ وصفه وصوره وانشر إعلانك بسعرك أنت. عندما يطلب زبون، ادخل طلبه من السلة بنفسك وحدّد سعر بيعك: ربحك = سعر بيعك − السعر الأساسي (5% على الأقل). التسويق يدوي بالكامل — لا توجد روابط إحالة للمنتجات.</p>
  <h3>متى تصبح عمولتي قابلة للسحب؟</h3>
  <p>تمر عمولتك بـ: قيد الانتظار (الطلب جديد) ← في التوصيل ← موافق عليها (بعد تسليم الطلب وتحصيل ثمنه نقداً) ← مدفوعة (بعد معالجة طلب الدفع). الطلبات الملغاة أو المرتجعة تُلغى عمولاتها.</p>
  <h3>كيفاش نسحب أرباحي؟</h3>
  <p>من محفظتك في لوحتك: اضبط وسيلة استلام أرباحك وتفاصيلها أولاً في إعدادات حسابك (بريدي موب، CCP، Flexy، ظرف بريدي، أو الاستلام من المقر)، ثم اضغط «طلب سحب الأرباح» واختر المبلغ — الإدارة تدفع لك فعلياً خارج المنصة وتوثّق الدفع في حسابك بالطريقة ومرجع العملية فتظهر في سجل مدفوعاتك.</p>
  <h3>واش هو برنامج ادعو أصدقائك؟</h3>
  <p>شارك رابط دعوتك من لوحتك: كل صديق ينضم كمسوق بدعوتك ويبلغ بأرباح موافق عليها 5000 دج، تربح أنت 500 دج مكافأة في رصيدك.</p>
  <h3>شكون يوصل الطلبات ويستلم الدراهم؟</h3>
  <p>المورد يجهز الطلب ويوصله عبر شركة توصيله، والزبون يدفع نقداً عند الاستلام. المنصة تنظم العرض والطلبات والأرباح فقط.</p>
  <h3>هل التوصيل للمنزل ولا للمكتب؟</h3>
  <p>الزبون يختار عند الطلب: توصيل للمنزل أو لمكتب شركة التوصيل — الأسعار لكل ولاية في صفحة «أسعار التوصيل».</p>`,
  training: `<h2>🎓 تدريب المسوقين — ابدأ في 6 خطوات</h2>
  <ol>
    <li><strong>اختر منتجاً رابحاً:</strong> ابدأ بمنتجات «الأكثر طلباً» في الصفحة الرئيسية — الطلب عليها مثبت.</li>
    <li><strong>جهّز موادك:</strong> من لوحتك أو صفحة المنتج: ⬇️ حمّل الصور و📋 انسخ الوصف — التسويق يدوي: أنت تنشر بموادك وحساباتك.</li>
    <li><strong>انشر إعلانك:</strong> في مجموعات فيسبوك وتيك توك وحالتك — صورة واضحة + فائدة المنتج + «الدفع عند الاستلام».</li>
    <li><strong>حدّد سعرك بذكاء:</strong> سعرك = السعر الأساسي + ربحك. ربح معقول (10–20%) يبيع أكثر من سعر مبالغ فيه.</li>
    <li><strong>ادخل طلب الزبون فوراً:</strong> الاسم والهاتف والولاية والبلدية والعنوان من السلة — واتصل بالزبون للتأكيد قبل الإرسال لتقليل المرتجعات.</li>
    <li><strong>تابع وطوّر:</strong> راقب حالات عمولاتك في محفظتك، وادعُ أصدقاءك برابط الدعوة لربح مكافآت إضافية.</li>
  </ol>
  <p class="muted">نصائح سريعة: رد على تعليقات الزبائن بسرعة، لا تعد بما لا يقدر عليه المنتج، وصوّر المنتج بنفسك إن وصلك — المحتوى الحقيقي يبيع أكثر.</p>`,
  contact: `<h2>الدعم والتواصل</h2>
  <p>راسلنا عبر النموذج أو مباشرة: <a href="https://wa.me/213791402649" target="_blank" rel="noopener">واتساب</a> · <a href="https://www.facebook.com/promotion.dizad" target="_blank" rel="noopener">صفحة فيسبوك SOUQAR</a></p>
  <form id="supportForm" class="stack">
    <input id="spName" placeholder="الاسم" required>
    <input id="spPhone" placeholder="رقم الهاتف" required>
    <textarea id="spMsg" placeholder="رسالتك…" required></textarea>
    <button class="btn gold" type="submit">إرسال</button>
  </form>`
};
async function openStore(supplierId) {
  show('page');
  $('#pageContent').innerHTML = '<p class="muted">جارٍ تحميل المتجر…</p>';
  try {
    const { supplier: s, products } = await api('/api/suppliers/' + supplierId + '/public');
    $('#pageContent').innerHTML = `
      <div class="card" style="text-align:center">
        <div style="font-size:44px">🏪</div>
        <h2 style="margin:4px 0">${esc(s.business_name || s.name)}</h2>
        <p class="muted">${esc(s.activity || '')}${s.wilaya_name ? ' · 📍 ' + esc(s.wilaya_name) : ''} · عضو منذ ${new Date(s.member_since).toLocaleDateString('ar-DZ')} · ${s.products_count} منتج</p>
        <p><span class="badge">مورد موثّق من إدارة SOUQAR ✅</span></p>
        <p><button class="btn small" id="followBtn" type="button">➕ متابعة المتجر</button> <span class="muted small" id="followCount"></span></p>
      </div>
      <div class="chip-row" id="storeTabs">
        <button class="chip on" data-stab="products" type="button">المنتجات</button>
        <button class="chip" data-stab="info" type="button">المعلومات</button>
        <button class="chip" data-stab="reviews" type="button">التقييمات</button>
      </div>
      <div id="stab-products">
        <div class="grid" id="storeGrid">${products.length ? products.map(productCard).join('') : '<p class="muted">لا منتجات معروضة حالياً في هذا المتجر.</p>'}</div>
      </div>
      <div id="stab-info" hidden>
        <div class="card">
          <p>🏪 <strong>${esc(s.business_name || s.name)}</strong></p>
          ${s.activity ? '<p>النشاط: ' + esc(s.activity) + '</p>' : ''}
          <p>📍 الولاية: ${esc(s.wilaya_name || '—')} · يوصّل إلى ${s.coverage_count || 0} ولاية</p>
          <p>🗓️ عضو منذ ${new Date(s.member_since).toLocaleDateString('ar-DZ')} · ${s.products_count} منتج معروض</p>
          <p>🚚 الرسوم الدقيقة لكل ولاية تظهر عند إتمام الطلب قبل التأكيد.</p>
        </div>
      </div>
      <div id="stab-reviews" hidden>
        <div class="card">
          <h4>⭐ تقييمات منتجات هذا المتجر ${s.rating_count ? '(' + s.rating_count + ')' : ''}</h4>
          ${s.rating_count ? '<p>' + starsHtml(s.rating_avg, s.rating_count) + '</p>' + (s.reviews || []).map((r) => '<div class="rev"><b>' + esc(r.user_name) + '</b> ' + starsOnly(r.stars) + ' <span class="muted small">عن: ' + esc(r.product_name) + '</span>' + (r.comment ? '<p>' + esc(r.comment) + '</p>' : '') + '</div>').join('') : '<p class="muted">لا تقييمات بعد على منتجات هذا المتجر.</p>'}
        </div>
      </div>`;
    wireCards('storeGrid');
    $$('#storeTabs .chip').forEach((ch) => ch.addEventListener('click', () => {
      $$('#storeTabs .chip').forEach((x) => x.classList.toggle('on', x === ch));
      for (const k of ['products', 'info', 'reviews']) { const el = $('#stab-' + k); if (el) el.hidden = k !== ch.dataset.stab; }
    }));
    try {
      const fs = await api('/api/suppliers/' + supplierId + '/follow');
      const fb = $('#followBtn'), fc = $('#followCount');
      const paint = () => { if (fb) fb.textContent = fs.following ? '✓ تتابع هذا المتجر' : '➕ متابعة المتجر'; if (fc) fc.textContent = fs.followers + ' متابِع'; };
      paint();
      if (fb) fb.addEventListener('click', async () => {
        if (!ME) { toast('سجّل الدخول أولاً لمتابعة المتجر', true); openAuth('login'); return; }
        try { const r = await api('/api/suppliers/' + supplierId + '/follow', { method: 'POST', body: {} }); fs.following = r.following; fs.followers = r.followers; paint(); toast(r.following ? 'أنت الآن تتابع هذا المتجر ✓' : 'ألغيت المتابعة'); }
        catch (e) { toast(e.message, true); }
      });
    } catch (e) { /* عدّاد المتابعة اختياري */ }
  } catch (e) { $('#pageContent').innerHTML = '<p class="muted">تعذر تحميل هذا المتجر.</p>'; }
}
async function openPage(key) {
  if (key === 'delivery') {
    show('page');
    $('#pageContent').innerHTML = '<h2>أسعار التوصيل</h2><p class="muted">جارٍ التحميل…</p>';
    try {
      const { coverage } = await api('/api/delivery-coverage');
      $('#pageContent').innerHTML = `<h2>أسعار التوصيل حسب الولاية</h2>
      <iframe title="خريطة الجزائر" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=-8.7%2C18.9%2C12.0%2C37.1&amp;layer=mapnik" style="width:100%;height:250px;border:1px solid var(--line);border-radius:14px;margin-bottom:12px"></iframe>
      <p>الجدول يعرض <strong>أرخص الأسعار المتاحة</strong> لكل ولاية عبر موردينا النشطين: سعر التوصيل <strong>إلى المنزل</strong> وسعر التوصيل <strong>إلى مكتب</strong> شركة التوصيل ومدة التوصيل التقديرية. الرسم الدقيق لطلبك يظهر قبل تأكيد الطلب حسب مورد المنتج.</p>
      ${coverage.length ? `<div class="tablewrap"><table><tr><th>الولاية</th><th>🏠 منزل</th><th>🏢 مكتب</th><th>المدة</th><th>موردون</th></tr>${coverage.map((c) => `<tr><td>${c.wilaya_code} — ${esc(c.name_ar)}</td><td>${fmt(c.min_fee)}</td><td>${fmt(c.min_office_fee)}</td><td>${esc(c.duration || '—')}</td><td>${c.suppliers}</td></tr>`).join('')}</table></div>` : '<p class="muted">لا توجد تغطية مضبوطة بعد — تُبنى القائمة تلقائياً من تغطية الموردين.</p>'}`;
    } catch (e) { $('#pageContent').innerHTML = '<h2>أسعار التوصيل</h2><p class="muted">تعذر التحميل الآن.</p>'; }
    return;
  }
  $('#pageContent').innerHTML = PAGES[key] || '';
  show('page');
  if (key === 'contact') {
    $('#supportForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('/api/support', { method: 'POST', body: { name: $('#spName').value, phone: $('#spPhone').value, message: $('#spMsg').value } });
        toast(r.message); e.target.reset();
      } catch (err) { toast(err.message, true); }
    });
  }
}

// ---------- المنتجات ----------
let FAVS = new Set(JSON.parse(localStorage.getItem('pd_favs') || '[]'));
let FAV_ONLY = false;
function saveFavs() { localStorage.setItem('pd_favs', JSON.stringify([...FAVS])); }
function starsHtml(avg, count) {
  if (!count) return '';
  const full = Math.max(0, Math.min(5, Math.round(avg || 0)));
  return `<span class="stars">${'★'.repeat(full)}<span class="off">${'★'.repeat(5 - full)}</span></span> <span class="small">${(avg || 0).toFixed(1)} (${count})</span>`;
}
function starsOnly(n) {
  const full = Math.max(0, Math.min(5, Math.round(n || 0)));
  return `<span class="stars">${'★'.repeat(full)}<span class="off">${'★'.repeat(5 - full)}</span></span>`;
}
function priceHtml(p) {
  if (p.compare_price && p.compare_price > p.customer_price) {
    const off = Math.round((1 - p.customer_price / p.compare_price) * 100);
    return `<span class="price">${fmt(p.customer_price)}</span> <s class="muted">${fmt(p.compare_price)}</s> <span class="badge out">خصم ${off}%</span>`;
  }
  return `<span class="price">${fmt(p.customer_price)}</span>`;
}
function productCard(p) {
  const disc = p.compare_price && p.compare_price > p.customer_price ? Math.round((1 - p.customer_price / p.compare_price) * 100) : 0;
  return `
    <article class="pcard">
      <div class="pcard-media" data-view="${p.id}" title="عرض التفاصيل">
        ${p.images && p.images.length ? `<img src="${esc(p.images[0])}" alt="${esc(p.name)}" loading="lazy">` : '<div class="noimg">📦</div>'}
        ${disc ? `<span class="disc-badge">-${disc}%</span>` : ''}
        <button class="fav-btn" data-fav="${p.id}" type="button" aria-label="المفضلة">${FAVS.has(p.id) ? '❤️' : '🤍'}</button>
        ${p.sold >= 3 ? `<span class="sold-badge">🔥 الأكثر مبيعاً</span>` : ''}
      </div>
      <div class="pcard-body">
        <h3 data-view="${p.id}" title="عرض التفاصيل">${esc(p.name)}</h3>
        ${p.rating_count ? starsHtml(p.rating_avg, p.rating_count) : `<span class="muted small">${esc(p.category_name || '')}</span>`}
        ${p.stock > 0 ? (p.stock <= 3 ? '<span class="badge out">بقي ' + p.stock + ' فقط</span>' : '<span class="stock-ok">● متوفر</span>') : '<span class="badge out">نفد المخزون</span>'}
        <div class="pcard-buyrow">${priceHtml(p)}</div>
        <button class="add-wide" data-add="${p.id}" type="button" ${p.stock <= 0 ? 'disabled' : ''}>🛒 أضف إلى السلة</button>
        <button class="details-link" data-view="${p.id}" type="button">عرض التفاصيل ←</button>
      </div>
    </article>`;
}
function wireCards(root) {
  $$('#' + root + ' [data-view]').forEach((b) => b.addEventListener('click', (e) => { if (e.target.closest('[data-fav],[data-add]')) return; openProduct(Number(b.dataset.view)); }));
  $$('#' + root + ' [data-add]').forEach((b) => b.addEventListener('click', () => { addToCart(Number(b.dataset.add), 1); }));
  $$('#' + root + ' [data-fav]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.fav);
    if (FAVS.has(id)) { FAVS.delete(id); toast('أُزيل من المفضلة'); } else { FAVS.add(id); toast('أُضيف إلى المفضلة ❤️'); }
    saveFavs(); loadProducts().catch(() => {});
  }));
}
function resetAllFilters() {
  $('#searchInput').value = ''; $('#catFilter').value = ''; $('#priceFilter').value = ''; $('#sortSel').value = '';
  if (FAV_ONLY) { FAV_ONLY = false; $('#favToggle').textContent = '🤍 مفضلتي'; }
  return loadProducts();
}
const CAT_ICONS_TOP = [['إلكترون', '💻'], ['هواتف', '📱'], ['أزياء', '👕'], ['ملابس', '👗'], ['جمال', '💄'], ['صحة', '💊'], ['منزل', '🏠'], ['مطبخ', '🍳'], ['رياضة', '🏋️'], ['لياقة', '🏋️'], ['أطفال', '🧸'], ['رضع', '🍼'], ['غذائ', '🛒'], ['أدوات', '🔧'], ['سيارات', '🚗'], ['حيوان', '🐾'], ['كتب', '📚'], ['ألعاب', '🎮'], ['ساعات', '⌚'], ['أحذية', '👟'], ['حقائب', '👜'], ['عطور', '🌸'], ['نظارات', '🕶️'], ['بيت', '🏠'], ['دراج', '🏍️'], ['شتاء', '🧣'], ['كهرومنزل', '🔌'], ['تكييف', '❄️'], ['تنظيم', '🗄️'], ['صوتيات', '🎧']];
function catIconFor(name) { for (const [k, ic] of CAT_ICONS_TOP) if (name.includes(k)) return ic; return '🛍️'; }
function renderCatChipsTop(cat) {
  const box = $('#catChipsTop'); if (!box) return;
  const withN = CATEGORIES.map((c) => ({ c, n: PRODUCTS.filter((p) => p.category_id === c.id).length })).filter((x) => x.n);
  box.innerHTML = `<button class="catchip ${!cat ? 'on' : ''}" data-ct="" type="button"><span aria-hidden="true">🛒</span> كل الأقسام</button>` +
    withN.map(({ c }) => `<button class="catchip ${String(c.id) === String(cat) ? 'on' : ''}" data-ct="${c.id}" type="button"><span aria-hidden="true">${catIconFor(c.name)}</span> ${esc(c.name)}</button>`).join('');
  $$('#catChipsTop [data-ct]').forEach((b) => b.addEventListener('click', () => { $('#catFilter').value = b.dataset.ct; loadProducts().catch(() => {}); document.getElementById('products').scrollIntoView({ behavior: 'smooth' }); }));
}
async function loadProducts() {
  const q = $('#searchInput').value.trim(), cat = $('#catFilter').value;
  const data = await api('/api/products?' + new URLSearchParams({ search: q, category: cat, sort: $('#sortSel').value }));
  PRODUCTS = data.products;
  const [min, max] = ($('#priceFilter').value || '-').split('-').map(Number);
  let list = PRODUCTS.filter((p) => !$('#priceFilter').value || (p.customer_price >= min && p.customer_price <= max));
  if (FAV_ONLY) list = list.filter((p) => FAVS.has(p.id));
  $('#productGrid').innerHTML = list.length ? list.map(productCard).join('') : '<p class="muted">' + (FAV_ONLY ? 'مفضلتك فارغة — اضغط 🤍 على أي منتج لإضافته هنا.' : 'لا توجد منتجات معتمدة معروضة حالياً. المنتجات تظهر هنا بعد مراجعة الإدارة للموردين ومنتجاتهم.') + '</p>';
  wireCards('productGrid');
  // أقسام الرئيسية + شرائح الفئات — تظهر في العرض الافتراضي فقط (بلا بحث/فلترة)
  const plain = !q && !cat && !$('#priceFilter').value && !FAV_ONLY;
  const fbEl = $('#filterBar'); if (fbEl) fbEl.hidden = plain;
  renderCatChipsTop(cat);
  const newest = [...PRODUCTS].sort((a, b) => b.id - a.id).slice(0, 4);
  const top = [...PRODUCTS].filter((p) => p.sold > 0).sort((a, b) => b.sold - a.sold).slice(0, 4);
  $('#secNew').hidden = !(plain && newest.length);
  $('#secTop').hidden = !(plain && top.length);
  const ssEl = $('#secShip'); if (ssEl) ssEl.hidden = !plain;
  if (plain) {
    $('#railNew').innerHTML = newest.map(productCard).join(''); wireCards('railNew');
    $('#railTop').innerHTML = top.map(productCard).join(''); wireCards('railTop');
    $('#catChips').innerHTML = CATEGORIES.map((c) => {
      const n = PRODUCTS.filter((p) => p.category_id === c.id).length;
      return n ? `<button class="chip" data-chip="${c.id}" type="button">${esc(c.name)} (${n})</button>` : '';
    }).join('');
    $$('#catChips [data-chip]').forEach((b) => b.addEventListener('click', () => { $('#catFilter').value = b.dataset.chip; loadProducts().catch(() => {}); document.getElementById('products').scrollIntoView({ behavior: 'smooth' }); }));
    // بلاطات الأقسام كيما نموذج التطبيق
    const CAT_ICONS = [['إلكترون', '💻'], ['هواتف', '📱'], ['أزياء', '👕'], ['ملابس', '👗'], ['جمال', '💄'], ['صحة', '💊'], ['منزل', '🏠'], ['مطبخ', '🍳'], ['رياضة', '🏋️'], ['لياقة', '🏋️'], ['أطفال', '🧸'], ['رضع', '🍼'], ['غذائ', '🛒'], ['أدوات', '🔧'], ['سيارات', '🚗'], ['حيوان', '🐾'], ['كتب', '📚'], ['ألعاب', '🎮'], ['ساعات', '⌚'], ['أحذية', '👟'], ['حقائب', '👜'], ['عطور', '🌸'], ['نظارات', '🕶️'], ['بيت', '🏠']];
    const iconFor = (name) => { for (const [k, ic] of CAT_ICONS) if (name.includes(k)) return ic; return '🛍️'; };
    const S = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    const CAT_ICONS_SVG = [['إلكترون', S('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>')], ['صوتيات', S('<path d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="13" width="4" height="6" rx="2"/><rect x="17" y="13" width="4" height="6" rx="2"/>')], ['كهرومنزل', S('<rect x="5" y="2.5" width="14" height="19" rx="2"/><circle cx="12" cy="13" r="4.2"/><circle cx="8.2" cy="5.6" r=".6" fill="currentColor"/><path d="M11 5.6h4.5"/>')], ['تكييف', S('<rect x="5" y="2.5" width="14" height="19" rx="2"/><circle cx="12" cy="13" r="4.2"/><circle cx="8.2" cy="5.6" r=".6" fill="currentColor"/><path d="M11 5.6h4.5"/>')], ['مطبخ', S('<path d="M3 11h18"/><path d="M5 11v2a7 7 0 0 0 14 0v-2"/><path d="M9.5 7.8a2.5 2.5 0 0 1 5 0"/>')], ['منزل', S('<path d="M5 11V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3"/><path d="M3 13.5A1.8 1.8 0 0 1 6.6 12v1.2h10.8V12a1.8 1.8 0 0 1 3.6 1.5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>')], ['تنظيم', S('<path d="M5 11V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3"/><path d="M3 13.5A1.8 1.8 0 0 1 6.6 12v1.2h10.8V12a1.8 1.8 0 0 1 3.6 1.5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>')], ['أطفال', S('<path d="M11 2.2h2l.6 2.8H10.4z"/><path d="M9.6 5h4.8l.9 2.6V19a2.4 2.4 0 0 1-2.4 2.4H11A2.4 2.4 0 0 1 8.6 19V7.6z"/><path d="M8.6 12h6.6"/>')], ['رضع', S('<path d="M11 2.2h2l.6 2.8H10.4z"/><path d="M9.6 5h4.8l.9 2.6V19a2.4 2.4 0 0 1-2.4 2.4H11A2.4 2.4 0 0 1 8.6 19V7.6z"/><path d="M8.6 12h6.6"/>')], ['ملابس', S('<path d="M8.5 4L3.5 6.8 5.4 10 7.5 8.8V20h9V8.8l2.1 1.2 1.9-3.2L15.5 4a3.8 3.8 0 0 1-7 0z"/>')], ['جمال', S('<path d="M10 9h4v10.5A1.5 1.5 0 0 1 12.5 21h-1A1.5 1.5 0 0 1 10 19.5z"/><path d="M10 9V6.5h6.5"/><path d="M12 6.5V4h5.5"/>')], ['صحة', S('<path d="M10 9h4v10.5A1.5 1.5 0 0 1 12.5 21h-1A1.5 1.5 0 0 1 10 19.5z"/><path d="M10 9V6.5h6.5"/><path d="M12 6.5V4h5.5"/>')], ['دراج', S('<circle cx="6" cy="16" r="3.4"/><circle cx="18" cy="16" r="3.4"/><path d="M6 16L9.8 8.2H14L18 16M9.8 8.2L8.4 5H6.2M14 8.2L12.8 5H11"/>')], ['شتاء', S('<circle cx="6" cy="16" r="3.4"/><circle cx="18" cy="16" r="3.4"/><path d="M6 16L9.8 8.2H14L18 16M9.8 8.2L8.4 5H6.2M14 8.2L12.8 5H11"/>')], ['ساعات', S('<circle cx="12" cy="12" r="5.4"/><path d="M12 9.2V12l2 2"/><path d="M9.6 2.8h4.8l-.6 3.4H10.2zM9.6 21.2h4.8l-.6-3.4H10.2z"/>')], ['هواتف', S('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>')]];
    const iconSvgFor = (name) => { for (const [k, ic] of CAT_ICONS_SVG) if (name.includes(k)) return ic; return S('<path d="M5 8h14l-1.1 11.2A2 2 0 0 1 15.9 21H8.1a2 2 0 0 1-2-2z"/><path d="M8.5 10.5V6.8a3.5 3.5 0 0 1 7 0v3.7"/>'); };
    const tiles = CATEGORIES.map((c) => ({ c, n: PRODUCTS.filter((p) => p.category_id === c.id).length })).filter((x) => x.n);
    $('#secCats').hidden = !tiles.length;
    $('#catTiles').innerHTML = tiles.map(({ c }) => `<button class="cat-circle" data-tile="${c.id}" type="button"><span class="cc-emoji">${iconSvgFor(c.name)}</span><b>${esc(c.name)}</b></button>`).join('') + `<button class="cat-circle" data-all="1" type="button"><span class="cc-emoji">${S('<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/>')}</span><b>المزيد</b></button>`;
    const pi = $('#promoImg'); const fpp = PRODUCTS.find((x) => x.images && x.images.length); if (pi && fpp) { pi.src = fpp.images[0]; pi.hidden = false; }
    $$('#catTiles [data-tile]').forEach((t) => t.addEventListener('click', () => { $('#catFilter').value = t.dataset.tile; loadProducts().catch(() => {}); document.getElementById('products').scrollIntoView({ behavior: 'smooth' }); }));
    $$('#catTiles [data-all]').forEach((t) => t.addEventListener('click', () => { resetAllFilters().catch(() => {}); document.getElementById('products').scrollIntoView({ behavior: 'smooth' }); toast('تعرض كل المنتجات والأقسام'); }));
    $$('#catTiles [data-tile]').forEach((t) => t.classList.toggle('on', String(t.dataset.tile) === String($('#catFilter').value)));
    const ctEl = $('#catTiles'); if (ctEl) ctEl.scrollLeft = 0;
  } else { $('#catChips').innerHTML = ''; $('#secCats').hidden = true; }
}
// وصف عربي جاهز لأي منتج وصفه الأصلي فارغ (بيانات المتجر بلا أوصاف) — عام وصادق بلا اختراع مواصفات
function descFor(p) {
  if (p.description && p.description.trim()) return p.description.trim();
  const cat = p.category_name || 'منتجات مختارة';
  return p.name + ' — من تشكيلة «' + cat + '» في متجرنا.\n\n'
    + '✔️ منتج عملي مختار بعناية، بجودة مضمونة وأفضل قيمة مقابل السعر.\n'
    + '✔️ سهل الاستعمال ومناسب للاستعمال اليومي.\n'
    + '✔️ الدفع نقداً عند الاستلام — ما تخلّص حتى يوصلك المنتج وتشوفو بعينيك.\n'
    + '✔️ التوصيل متوفر لـ58 ولاية، إلى المنزل أو إلى مكتب شركة التوصيل، والإجمالي يظهر لك كاملاً قبل تأكيد الطلب.\n\n'
    + 'للطلب اضغط «اشترِ الآن» وعمّر معلوماتك، أو أضف المنتج إلى السلة وأكمل تسوّقك.';
}
function openLightbox(src) { if (!src) return; $('#lightboxImg').src = src; $('#lightbox').hidden = false; }
async function openProduct(id) {
  const { product: p } = await api('/api/products/' + id);
  const box = $('#productPage');
  const pageUrl = location.origin + '/?product=' + p.id;
  box.innerHTML = `
    ${p.images.length ? `<div class="pp-media"><img class="main-img pp-main" id="pmMain" src="${esc(p.images[0])}" alt="${esc(p.name)}" title="اضغط للتكبير"><span class="img-count" id="pmCount">1 / ${p.images.length}</span><div class="pm-topbar"><button class="pm-tb" id="ppBack" type="button" aria-label="رجوع">→</button><span class="pm-tb-group"><button class="pm-tb" id="pmShare" type="button" aria-label="مشاركة">↗</button><button class="pm-tb" id="pmCartGo" type="button" aria-label="السلة">🛒</button></span></div></div>
    <div class="gallery">${p.images.map((im, i) => `<img src="${esc(im)}" data-g="${i}" class="${i === 0 ? 'sel' : ''}" alt="">`).join('')}</div>` : `<div class="pp-media"><div class="noimg pp-noimg">📦</div><div class="pm-topbar"><button class="pm-tb" id="ppBack" type="button" aria-label="رجوع">→</button><span class="pm-tb-group"><button class="pm-tb" id="pmShare" type="button" aria-label="مشاركة">↗</button><button class="pm-tb" id="pmCartGo" type="button" aria-label="السلة">🛒</button></span></div></div>`}
    <h3 class="pp-title" dir="auto">${esc(p.name)}</h3>
    <p>${priceHtml(p)}</p>
    <p>${p.stock > 0 ? '<span class="badge pp-stock">✔ متوفر في المخزون — بقي ' + p.stock + '</span>' : '<span class="badge out">نفد المخزون</span>'}</p>
    <div class="pp-feats">
      <div>↩️<b>إرجاع سهل</b><span>خلال 7 أيام</span></div>
      <div>🛡️<b>دفع آمن</b><span>عند الاستلام</span></div>
      <div>🚚<b>توصيل سريع</b><span>${esc((p.coverage[0] && p.coverage[0].duration) || '24-72 ساعة')}</span></div>
    </div>
    <p class="muted small">🏪 المتجر: <a href="#" id="pmStore"><strong>${esc(p.business_name || p.supplier_name || 'متجر المورد')}</strong></a> — اضغط لعرض كل منتجات هذا المتجر</p>
    <div class="pp-desc card"><h4>📝 وصف المنتج</h4><p>${esc(descFor(p)).replace(/\n/g, '<br>')}</p></div>
    ${p.sizes.length ? `<div>المقاس<div class="swatches" id="pmSizes">${p.sizes.map((s, i) => `<button type="button" data-size="${esc(s)}" class="${i === 0 ? 'sel' : ''}">${esc(s)}</button>`).join('')}</div></div>` : ''}
    ${p.colors.length ? `<div>اللون<div class="swatches" id="pmColors">${p.colors.map((s, i) => `<button type="button" data-color="${esc(s)}" class="${i === 0 ? 'sel' : ''}">${esc(s)}</button>`).join('')}</div></div>` : ''}
    <div class="qty-row"><span>الكمية</span><span class="qty-stepper"><button type="button" id="pmQtyMinus" aria-label="إنقاص">−</button><input type="number" id="pmQty" value="1" min="1" max="99"><button type="button" id="pmQtyPlus" aria-label="زيادة">+</button></span></div>
    ${ME && ME.role === 'marketer' ? `<p class="badge" style="display:block;padding:10px">💼 للمسوق: هذا هو <strong>السعر الأساسي</strong> — عمولتك حسب اختيارك: حدّد سعر بيعك في السلة وربحك هو الفرق (5% على الأقل من السعر الأساسي).</p>` : ''}
    <details><summary>الولايات المتوفرة وتكلفة التوصيل لكل ولاية (منزل / مكتب)</summary>
      <div class="kv">${p.coverage.length ? p.coverage.map((c) => `<span>${wilayaName(c.wilaya_code)}: منزل ${fmt(c.delivery_fee)}${c.fee_office != null ? ' · مكتب ' + fmt(c.fee_office) : ''}${c.duration ? ' · ' + esc(c.duration) : ''}</span>`).join('') : '<span class="muted">لم يضبط المورد تغطية التوصيل بعد</span>'}</div>
    </details>
    <div class="share-row">
      <button class="btn light small" id="pmCopyDesc" type="button">📋 نسخ الوصف</button>
      ${p.images.length ? `<button class="btn light small" id="pmDlImgs" type="button">⬇️ تحميل الصور</button>` : ''}
      <button class="btn light small" id="pmFav" type="button">${FAVS.has(p.id) ? '❤️ في المفضلة' : '🤍 أضف للمفضلة'}</button>
    </div>
    <div id="pmReviews"></div>
    <div id="pmSimilar"></div>
    <div class="share-row">
      <a class="btn light small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(p.name + ' — ' + fmt(p.customer_price) + ' ' + pageUrl)}">مشاركة واتساب</a>
      <a class="btn light small" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(p.name)}">مشاركة تيليغرام</a>
      <a class="btn light small" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}">مشاركة فيسبوك</a>
      <a class="btn light small" target="_blank" rel="noopener" href="https://m.me/promotion.dizad">مراسلة الصفحة</a>
    </div>
    <div class="buy-row buy-bar">
      <button class="fav-circle" id="pmFavBar" type="button" aria-label="المفضلة">${FAVS.has(p.id) ? '❤️' : '🤍'}</button>
      <button class="btn gold big" id="pmAdd" ${p.stock <= 0 ? 'disabled' : ''}>🛒 أضف إلى السلة</button>
      <button class="btn big" id="pmBuyNow" ${p.stock <= 0 ? 'disabled' : ''}>⚡ اشترِ الآن</button>
    </div>`;
  show('product');
  $('#ppBack').addEventListener('click', () => show('home'));
  const shBtn = $('#pmShare');
  if (shBtn) shBtn.addEventListener('click', async () => {
    if (navigator.share) { try { await navigator.share({ title: p.name, text: p.name + ' — ' + fmt(p.customer_price), url: pageUrl }); } catch {} }
    else { const ok = await copyText(pageUrl); toast(ok ? 'نُسخ رابط المنتج ✓' : 'تعذّر النسخ — انسخ الرابط يدوياً', !ok); }
  });
  const cgBtn = $('#pmCartGo');
  if (cgBtn) cgBtn.addEventListener('click', async () => { $('#cartDrawer').hidden = false; await renderCart(); });
  const qIn = $('#pmQty');
  $('#pmQtyMinus').addEventListener('click', () => { qIn.value = Math.max(1, (Number(qIn.value) || 1) - 1); });
  $('#pmQtyPlus').addEventListener('click', () => { qIn.value = Math.min(99, (Number(qIn.value) || 1) + 1); });
  const mainImg = $('#pmMain');
  if (mainImg) mainImg.addEventListener('click', () => openLightbox(mainImg.src));
  $$('#productPage [data-g]').forEach((im) => im.addEventListener('click', () => {
    $('#pmMain').src = im.src; $$('#productPage [data-g]').forEach((x) => x.classList.remove('sel')); im.classList.add('sel');
    const cnt = $('#pmCount'); if (cnt) cnt.textContent = (Number(im.dataset.g) + 1) + ' / ' + p.images.length;
  }));
  let selSize = p.sizes[0] || null, selColor = p.colors[0] || null;
  $$('#pmSizes [data-size]').forEach((b) => b.addEventListener('click', () => { selSize = b.dataset.size; $$('#pmSizes [data-size]').forEach((x) => x.classList.toggle('sel', x === b)); }));
  $$('#pmColors [data-color]').forEach((b) => b.addEventListener('click', () => { selColor = b.dataset.color; $$('#pmColors [data-color]').forEach((x) => x.classList.toggle('sel', x === b)); }));
  $('#pmStore').addEventListener('click', (e) => { e.preventDefault(); openStore(p.supplier_id); });
  const rvBox = $('#pmReviews');
  if (rvBox) {
    const revs = p.reviews || [];
    rvBox.innerHTML = '<h4>⭐ تقييمات المشترين ' + (p.rating_count ? '(' + p.rating_count + ')' : '') + '</h4>' +
      (p.rating_count ? '<p>' + starsHtml(p.rating_avg, p.rating_count) + '</p>' : '<p class="muted">لا تقييمات بعد — كن أول من يقيّم بعد الشراء والاستلام.</p>') +
      revs.map((r) => '<div class="rev"><b>' + esc(r.user_name) + '</b> ' + starsOnly(r.stars) + '<br><span class="muted small">' + new Date(r.created_at).toLocaleDateString('ar-DZ') + '</span>' + (r.comment ? '<p>' + esc(r.comment) + '</p>' : '') + '</div>').join('') +
      (ME ? '<form id="rateForm" class="rate-form stack"><div class="star-pick" id="starPick">' + [1, 2, 3, 4, 5].map((n) => '<button type="button" data-star="' + n + '">★</button>').join('') + '</div><textarea id="rateComment" rows="2" placeholder="رأيك في المنتج (اختياري)"></textarea><button class="btn small" type="submit">نشر التقييم</button><p class="muted small">التقييم متاح لمن استلم طلباً فيه هذا المنتج.</p></form>' : '<p class="muted small">سجّل الدخول واشترِ المنتج لتقييمه بعد الاستلام.</p>');
    if (ME) {
      let myStars = 0;
      $$('#starPick button').forEach((b) => b.addEventListener('click', () => { myStars = Number(b.dataset.star); $$('#starPick button').forEach((x) => x.classList.toggle('on', Number(x.dataset.star) <= myStars)); }));
      $('#rateForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!myStars) return toast('اختر عدد النجوم أولاً', true);
        try { await api('/api/products/' + p.id + '/reviews', { method: 'POST', body: { stars: myStars, comment: $('#rateComment').value } }); toast('شكراً! نُشر تقييمك ✓'); openProduct(p.id); }
        catch (err) { toast(err.message, true); }
      });
    }
  }
  $('#pmAdd').addEventListener('click', () => {
    addToCart(p.id, Number($('#pmQty').value) || 1, selSize, selColor);
  });
  $('#pmBuyNow').addEventListener('click', async () => {
    // شراء فوري بمنتج واحد — دون إضافة للسلة (طلب مكرر كان يحدث سابقاً)
    openCheckout([{ productId: p.id, qty: Number($('#pmQty').value) || 1, size: selSize, color: selColor, name: p.name, price: p.customer_price, image: p.images && p.images.length ? p.images[0] : null, supplier_id: p.supplier_id }]);
  });
  $('#pmCopyDesc').addEventListener('click', async () => {
    const isMk = ME && ME.role === 'marketer';
    // للمسوق: بلا سعر — السعر الأساسي لا يُلصق في إعلانه فيلغي هامشه (تدقيق 2026-10-25)
    const txt = isMk
      ? `${p.name}\n${descFor(p)}\n✅ الدفع عند الاستلام — للطلب والاستفسار راسلني`
      : `${p.name}\n${descFor(p)}\n💰 السعر: ${fmt(p.customer_price)} — الدفع عند الاستلام\n${pageUrl}`;
    const ok = await copyText(txt);
    if (ok) toast(isMk ? 'نُسخ الوصف بلا سعر — أضف سعرك أنت في إعلانك' : 'نُسخ وصف المنتج — الصقه في إعلانك');
    else toast('تعذّر النسخ التلقائي — حدّد النص يدوياً وانسخه', true);
  });
  const dlb = $('#pmDlImgs');
  if (dlb) dlb.addEventListener('click', () => downloadImages(p));
  $('#pmFav').addEventListener('click', () => {
    if (FAVS.has(p.id)) FAVS.delete(p.id); else FAVS.add(p.id);
    saveFavs(); $('#pmFav').textContent = FAVS.has(p.id) ? '❤️ في المفضلة' : '🤍 أضف للمفضلة'; const fb = $('#pmFavBar'); if (fb) fb.textContent = FAVS.has(p.id) ? '❤️' : '🤍'; loadProducts().catch(() => {});
  });
  const fbBtn = $('#pmFavBar');
  if (fbBtn) fbBtn.addEventListener('click', () => $('#pmFav').click());
  const similar = PRODUCTS.filter((x) => x.id !== p.id && x.category_id && x.category_id === p.category_id).slice(0, 4);
  if (similar.length) {
    $('#pmSimilar').innerHTML = '<h4>منتجات مماثلة</h4><div class="grid">' + similar.map(productCard).join('') + '</div>';
    wireCards('pmSimilar');
  }
}
function wilayaName(code) { const w = WILAYAS.find((x) => x.code === Number(code)); return w ? w.code + ' — ' + w.name_ar : code; }

// ---------- السلة والطلب ----------
function saveCart() { localStorage.setItem('pd_cart', JSON.stringify(CART)); renderCartBadge(); }
function renderCartBadge() {
  const n = CART.reduce((a, i) => a + i.qty, 0);
  $('#cartCount').hidden = n === 0; $('#cartCount').textContent = n;
  const mc = $('#mCartCount'); if (mc) { mc.hidden = n === 0; mc.textContent = n; }
}
function addToCart(productId, qty, size, color) {
  const p = PRODUCTS.find((x) => x.id === productId);
  const ex = CART.find((i) => i.productId === productId && i.size === size && i.color === color);
  if (ex) ex.qty += qty; else CART.push({ productId, qty, size: size || null, color: color || null, name: p ? p.name : ('منتج ' + productId), price: p ? p.customer_price : 0, image: p && p.images ? p.images[0] : null, supplier_id: p ? p.supplier_id : null });
  checkoutKey = null; sessionStorage.removeItem('pd_checkout_key');
  saveCart(); toast('أُضيف إلى السلة');
}
function sellOf(i) {
  if (!ME || ME.role !== 'marketer') return i.price;
  const min = Math.ceil(i.price * 1.05);
  return i.sellPrice && i.sellPrice >= min ? i.sellPrice : min;
}
async function renderCart() {
  const box = $('#cartItems');
  if (!CART.length) { box.innerHTML = '<p class="muted">السلة فارغة.</p>'; const t = $('#coTotals'); t.innerHTML = ''; t.hidden = true; return; }
  const isMk = ME && ME.role === 'marketer';
  box.innerHTML = (isMk ? '<p class="muted small">💼 أنت مسوق: حدّد <strong>سعر البيع للزبون</strong> لكل منتج — ربحك هو الفرق عن السعر الأساسي (5% على الأقل).</p>' : '') + CART.map((i, idx) => `
    <div class="cart-item">
      ${i.image ? `<img src="${esc(i.image)}" alt="">` : ''}
      <div class="ci-main"><strong class="ci-name" dir="auto">${esc(i.name)}</strong><span class="muted small">${i.size ? 'مقاس ' + esc(i.size) + ' · ' : ''}${i.color ? esc(i.color) + ' · ' : ''}السعر الأساسي ${fmt(i.price)}</span>
      ${isMk ? `<br><label class="small">سعر بيعك للزبون <input type="number" data-sell="${idx}" value="${sellOf(i)}" min="${Math.ceil(i.price * 1.05)}" style="width:110px"> <span class="badge">ربحك ${fmt((sellOf(i) - i.price) * i.qty)}</span></label>` : ''}
      <div class="ci-row"><div class="qty"><button data-dec="${idx}" type="button">−</button><span>${i.qty}</span><button data-inc="${idx}" type="button">+</button></div><strong>${fmt(sellOf(i) * i.qty)}</strong><button class="icon-btn dark" data-del="${idx}" type="button">🗑 حذف</button></div></div>
    </div>`).join('');
  $$('#cartItems [data-inc]').forEach((b) => b.addEventListener('click', () => { CART[+b.dataset.inc].qty++; saveCart(); renderCart(); }));
  $$('#cartItems [data-dec]').forEach((b) => b.addEventListener('click', () => { const it = CART[+b.dataset.dec]; it.qty = Math.max(1, it.qty - 1); saveCart(); renderCart(); }));
  $$('#cartItems [data-del]').forEach((b) => b.addEventListener('click', () => { CART.splice(+b.dataset.del, 1); saveCart(); renderCart(); }));
  $$('#cartItems [data-sell]').forEach((inp) => inp.addEventListener('change', () => { CART[+inp.dataset.sell].sellPrice = Number(inp.value) || null; saveCart(); renderCart(); }));
  await updateTotals();
}
async function updateTotals(items) {
  const SRC = items || CART;
  $('#coTotals').hidden = false;
  const w = Number($('#coWilaya').value);
  const isMk = ME && ME.role === 'marketer';
  const subtotal = SRC.reduce((a, i) => a + sellOf(i) * i.qty, 0);
  let html = `<div>مجموع المنتجات: <strong>${fmt(subtotal)}</strong></div>`;
  if (isMk) html += `<div>💰 عمولتك المتوقعة من هذا الطلب: <strong>${fmt(SRC.reduce((a, i) => a + (sellOf(i) - i.price) * i.qty, 0))}</strong></div>`;
  if (w) {
    try {
      const fees = {};
      const office = $('#coDelType') && $('#coDelType').value === 'office';
      for (const i of SRC) {
        const { product } = await api('/api/products/' + i.productId);
        const cov = product.coverage.find((c) => c.wilaya_code === w);
        fees[product.supplier_id] = cov ? (office && cov.fee_office != null ? cov.fee_office : cov.delivery_fee) : null;
      }
      let delivery = 0, missing = false;
      for (const f of Object.values(fees)) { if (f === null) missing = true; else delivery += f; }
      if (missing) html += '<div class="muted">⚠️ أحد الموردين لا يغطي هذه الولاية — سيُرفض الطلب عند التأكيد.</div>';
      else html += `<div>التوصيل: <strong>${fmt(delivery)}</strong></div><div class="grand">الإجمالي عند الاستلام: ${fmt(subtotal + delivery)}</div>`;
    } catch { html += '<div class="muted">تعذر حساب التوصيل الآن — سيُحسب نهائياً في الخادم عند التأكيد.</div>'; }
  } else html += '<div class="muted">اختر الولاية لحساب التوصيل والإجمالي.</div>';
  $('#coTotals').innerHTML = html;
}

// ---------- صفحة إتمام الطلب (مستقلة، كيما متاجر AliExpress) ----------
function renderCheckoutItems() {
  const box = $('#coItems');
  const SRC = CO_ITEMS || CART;
  if (!SRC.length) { box.innerHTML = '<p class="muted">السلة فارغة.</p>'; return; }
  box.innerHTML = '<div class="card"><h4>🛍️ ملخص الطلب</h4>' + SRC.map((i) => `
    <div class="cart-item">
      ${i.image ? `<img src="${esc(i.image)}" alt="">` : ''}
      <div class="ci-main"><strong class="ci-name" dir="auto">${esc(i.name)}</strong>
      <span class="muted small">${i.size ? 'مقاس ' + esc(i.size) + ' · ' : ''}${i.color ? esc(i.color) + ' · ' : ''}الكمية: ${i.qty} × ${fmt(sellOf(i))}</span></div>
      <strong>${fmt(sellOf(i) * i.qty)}</strong>
    </div>`).join('') + '</div>';
}
function openCheckout(items) {
  CO_ITEMS = Array.isArray(items) && items.length ? items : null;
  const SRC = CO_ITEMS || CART;
  if (!SRC.length) return toast('السلة فارغة — أضف منتجاً أولاً', true);
  $('#cartDrawer').hidden = true;
  renderCheckoutItems();
  show('checkout');
  updateTotals(SRC);
}

// ---------- تفاصيل الطلبية الكاملة ----------
async function openOrderDetails(id) {
  try {
    const d = await api('/api/orders/' + id + '/details');
    const o = d.order;
    const moneyRows = [
      ['مجموع المنتجات', fmt(o.subtotal)],
      ['التوصيل', fmt(o.delivery_fee)],
      ['الإجمالي عند الاستلام', fmt(o.total)],
      ...(o.wholesale_total !== undefined ? [['مجموع الجملة (للمورد)', fmt(o.wholesale_total)]] : []),
      ...(o.margin_total !== undefined ? [['هامش المنصة الكلي', fmt(o.margin_total)], ['عمولات المسوق الكلية', fmt(o.commission_total)], ['صافي المنصة', fmt(o.platform_net)]] : []),
      ...(o.commission_total !== undefined && o.margin_total === undefined ? [['عمولتك من هذه الطلبية', fmt(o.commission_total)]] : [])
    ];
    $('#orderModalBox').innerHTML = `
      <div class="drawer-head"><h3>📋 طلبية رقم ${esc(o.ref)}</h3><span><button class="btn small light" id="printReceipt" type="button">🧾 الوصل</button> <button class="icon-btn dark" id="closeOrderModal" type="button">✕</button></span></div>
      <p><span class="badge">${esc(o.status_label)}</span> <span class="muted">أُنشئت: ${new Date(o.created_at).toLocaleString('ar-DZ')} · آخر تحديث: ${new Date(o.updated_at).toLocaleString('ar-DZ')}</span></p>
      ${o.buyer_name ? `<div class="card"><h4>المشتري والتوصيل</h4>
        <p>الاسم: <strong>${esc(o.buyer_name || '')}</strong><br>الهاتف: <strong>${esc(o.buyer_phone || '')}</strong><br>
        الولاية: ${esc(o.wilaya_name)} (${o.wilaya}) · البلدية: ${esc(o.commune)}<br>العنوان: ${esc(o.address || '')}</p></div>` : ''}
      <div class="card"><h4>المنتجات</h4><div class="tablewrap"><table>
        <tr><th>المنتج</th><th>الكمية</th><th>سعر الزبون</th><th>المجموع</th>${d.items.some((i) => i.wholesale_price !== undefined) ? '<th>الجملة</th>' : ''}${d.items.some((i) => i.platform_margin !== undefined) ? '<th>الهامش</th><th>العمولة</th>' : ''}${d.items.some((i) => i.commission_total !== undefined) ? '<th>عمولتك</th>' : ''}</tr>
        ${d.items.map((i) => `<tr><td>${esc(i.name)}${i.size ? ' · مقاس ' + esc(i.size) : ''}${i.color ? ' · ' + esc(i.color) : ''}</td><td>${i.qty}</td><td>${fmt(i.customer_price)}</td><td>${fmt(i.line_total)}</td>
          ${i.wholesale_price !== undefined ? `<td>${fmt(i.wholesale_price)}</td>` : ''}${i.platform_margin !== undefined ? `<td>${fmt(i.platform_margin)}</td><td>${fmt(i.marketer_commission)}</td>` : ''}${i.commission_total !== undefined ? `<td>${fmt(i.commission_total)}</td>` : ''}</tr>`).join('')}
      </table></div></div>
      <div class="totals">${moneyRows.map(([k, v]) => `<div>${k}: <strong>${v}</strong></div>`).join('')}</div>
      <div class="card"><h4>الأطراف</h4>
        <p>المورد: <strong>${esc(o.supplier ? (o.supplier.business_name || o.supplier.name) : '')}</strong>
        ${o.marketer !== undefined ? `<br>المسوق: ${o.marketer ? '<strong>' + esc(o.marketer.name) + '</strong>' : 'بيع مباشر بلا مسوق'}` : ''}</p></div>
      ${o.reject_reason ? `<p class="muted">سبب الرفض/الإلغاء: ${esc(o.reject_reason)}</p>` : ''}
      <div class="card"><h4>سجل حالات الطلبية</h4>
        ${d.history.length ? d.history.map((h) => `<p class="small">${new Date(h.created_at).toLocaleString('ar-DZ')} — ${esc(h.label)}${h.note ? ' · ' + esc(h.note) : ''}</p>`).join('') : '<p class="muted">لا سجل بعد.</p>'}</div>`;
    $('#orderModal').hidden = false;
    $('#closeOrderModal').addEventListener('click', () => { $('#orderModal').hidden = true; });
    $('#printReceipt').addEventListener('click', () => printReceipt(d));
  } catch (e) { toast(e.message, true); }
}
function printReceipt(d) {
  const o = d.order;
  const lines = [
    'SOUQAR — وصل طلبية ' + o.ref,
    'التاريخ: ' + new Date(o.created_at).toLocaleString('ar-DZ') + ' · الحالة: ' + o.status_label,
    o.buyer_name ? 'المشتري: ' + o.buyer_name + ' — ' + (o.buyer_phone || '') + '\nالولاية: ' + o.wilaya_name + ' · البلدية: ' + (o.commune || '') + '\nالعنوان: ' + (o.address || '') : '',
    ...d.items.map((i) => '• ' + i.name + (i.size ? ' · ' + i.size : '') + (i.color ? ' · ' + i.color : '') + ' × ' + i.qty + ' = ' + fmt(i.line_total)),
    'مجموع المنتجات: ' + fmt(o.subtotal),
    'التوصيل: ' + fmt(o.delivery_fee),
    'الإجمالي عند الاستلام: ' + fmt(o.total),
    'المورد: ' + (o.supplier ? (o.supplier.business_name || o.supplier.name) : ''),
    'شكراً لثقتكم — SOUQAR',
  ].filter(Boolean).join('\n');
  const rows = d.items.map((i) => `<tr><td>${esc(i.name)}${i.size ? ' · ' + esc(i.size) : ''}${i.color ? ' · ' + esc(i.color) : ''}</td><td>${i.qty}</td><td>${fmt(i.customer_price)}</td><td>${fmt(i.line_total)}</td></tr>`).join('');
  const receiptHtml = `<h3 style="margin-top:0">SOUQAR — وصل طلبية</h3>
    <p>رقم الطلبية: <strong>${esc(o.ref)}</strong><br>التاريخ: ${new Date(o.created_at).toLocaleString('ar-DZ')}<br>الحالة: ${esc(o.status_label)}</p>
    ${o.buyer_name ? `<p>المشتري: ${esc(o.buyer_name)} — ${esc(o.buyer_phone || '')}<br>الولاية: ${esc(o.wilaya_name)} · البلدية: ${esc(o.commune)}<br>العنوان: ${esc(o.address || '')}</p>` : ''}
    <div class="tbl-wrap"><table><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr>${rows}</table></div>
    <p><strong>مجموع المنتجات: ${fmt(o.subtotal)}<br>التوصيل: ${fmt(o.delivery_fee)}<br>الإجمالي عند الاستلام: ${fmt(o.total)}</strong></p>
    <p>المورد: ${esc(o.supplier ? (o.supplier.business_name || o.supplier.name) : '')}</p>
    <p>شكراً لثقتكم — SOUQAR</p>`;
  $('#orderModalBox').innerHTML = receiptHtml + `
    <div class="actions-row">
      <button class="btn" id="rcShare" type="button">📤 مشاركة الوصل</button>
      <button class="btn light" id="rcCopy" type="button">📋 نسخ النص</button>
      <button class="btn light" id="rcPrint" type="button">🖨 طباعة</button>
      <button class="btn light" id="rcClose" type="button">✕ إغلاق</button>
    </div>`;
  $('#orderModal').hidden = false;
  $('#rcClose').addEventListener('click', () => { $('#orderModal').hidden = true; });
  $('#rcCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(lines); toast('نُسخ الوصل ✓'); } catch { toast('تعذّر النسخ', true); } });
  $('#rcShare').addEventListener('click', async () => {
    if (navigator.share) { try { await navigator.share({ title: 'وصل طلبية ' + o.ref, text: lines }); } catch {} }
    else { try { await navigator.clipboard.writeText(lines); toast('نُسخ الوصل — الصقه أين تشاء ✓'); } catch { toast('المشاركة غير متاحة هنا', true); } }
  });
  $('#rcPrint').addEventListener('click', () => {
    let pa = document.getElementById('printArea');
    if (!pa) { pa = document.createElement('div'); pa.id = 'printArea'; document.body.appendChild(pa); }
    pa.innerHTML = receiptHtml;
    window.print();
  });
}
async function reorder(orderId, btn) {
  try {
    const d = await api('/api/orders/' + orderId + '/details');
    const { products } = await api('/api/products');
    let added = 0, missing = [];
    for (const i of d.items) {
      const p = products.find((x) => x.id === i.product_id);
      if (p && p.stock > 0) { addToCart(p.id, Math.min(i.qty, p.stock), i.size || undefined, i.color || undefined); added++; }
      else missing.push(i.name);
    }
    if (added) { toast('أُضيف ' + added + ' منتج من الطلبية السابقة إلى السلة'); renderCart(); $('#cartDrawer').hidden = false; }
    if (missing.length) toast('غير متوفر حالياً: ' + missing.join('، '), true);
    if (!added && !missing.length) toast('لا منتجات في هذه الطلبية', true);
  } catch (e) { toast(e.message, true); }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-details]');
  if (b) { e.preventDefault(); openOrderDetails(b.dataset.details); return; }
  const rb = e.target.closest('[data-reorder]');
  if (rb) { e.preventDefault(); reorder(rb.dataset.reorder, rb); return; }
  if (e.target.id === 'orderModal') $('#orderModal').hidden = true;
});

// ---------- المصادقة ----------
let regRole = 'buyer';
const ROLE_HINTS = {
  buyer: 'حساب مشتري: اطلب وتابع طلباتك وسجل مشترياتك.',
  marketer: 'حساب مسوق: تسويق يدوي بلا روابط — سوّق بنفسك وأدخل طلبات زبائنك بسعرك، عمولات موثقة تُثبت بعد التسليم والتحصيل فقط.',
  supplier: 'حساب مورد: تُراجع الإدارة حسابك أولاً، ثم تنشر منتجاتك وتستقبل الطلبات الموجهة إليك آلياً.'
};
function selectRole(r) {
  regRole = r;
  $$('.role-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.role === r));
  $('#roleHint').textContent = ROLE_HINTS[r];
  $('#marketerFields').hidden = r !== 'marketer';
  const em = $('#rgEmail');
  em.required = false;
  em.placeholder = 'البريد الإلكتروني (اختياري)';
}
async function refreshMe() {
  const data = await api('/api/me');
  ME = data.user; CSRF = data.csrf || CSRF;
  $('#authBtn').hidden = !!ME;
  $('#dashBtn').hidden = !ME; $('#logoutBtn').hidden = !ME; $('#bellBtn').hidden = !ME;
  if (ME) { $('#dashTitle').textContent = ME.role === 'admin' ? 'لوحتي' : 'لوحة ' + ({ supplier: 'المورد', marketer: 'المسوق', buyer: 'المشتري' }[ME.role] || ''); $('#dashUser').textContent = ME.name + ' · ' + ME.phone + ' · ' + ({ admin: 'صاحب المنصة', supplier: 'مورد', marketer: 'مسوق', buyer: 'مشتري' }[ME.role] || ''); }
  if (ME) api('/api/my/notifications').then((r) => updateBellBadge(r.unread || 0)).catch(() => {});
  return ME;
}
function updateBellBadge(n) {
  const b = $('#bellBadge'); if (!b) return;
  b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n || '');
}

// ---------- لوحات التحكم ----------
const STATUS_FLOW = ['pending_supplier', 'confirmed', 'preparing', 'handed', 'out_for_delivery', 'delivered_collected', 'failed_delivery', 'returned', 'cancelled', 'rejected'];
const STATUS_AR = { pending_supplier: 'جديد — بانتظار تأكيد المورد', confirmed: 'مؤكد', preparing: 'قيد التجهيز', handed: 'سُلّم لشركة التوصيل', out_for_delivery: 'خرج للتوصيل', delivered_collected: 'تم التسليم والتحصيل', cancelled: 'أُلغي', rejected: 'مرفوض', failed_delivery: 'تعذر التسليم', returned: 'مرتجع' };

function renderSettings() {
  const box = $('#dashSettings');
  if (!ME) { box.innerHTML = ''; return; }
  const payMethods = ['تحويل بريدي موب', 'تحويل البريد الجاري', 'التحصيل من مقر المنصة', 'Enveloppe', 'Flexy', 'نقداً عند الاستلام من الإدارة'];
  box.innerHTML = `
  <div class="card" id="sec-profile"><h3>👤 بياناتي</h3>
    <p class="muted small">${esc(ME.name)} · 📱 ${esc(ME.phone)} — رقم الهاتف هو معرّف الدخول ولا يتغيّر من هنا.</p>
    <form id="profileForm" class="stack">
      <label>الاسم الكامل<input id="stName" value="${esc(ME.name)}" placeholder="الاسم الكامل"></label>
      <label>البريد الإلكتروني<input id="stEmail" type="email" value="${esc(ME.email || '')}" placeholder="البريد الإلكتروني"></label>
      <label>الولاية<select id="stWilaya"><option value="">— الولاية —</option>${WILAYAS.map((w) => `<option value="${w.code}" ${ME.wilaya === w.code ? 'selected' : ''}>${w.code} — ${esc(w.name_ar)}</option>`).join('')}</select></label>
      <label>البلدية<input id="stCommune" list="communeList" value="${esc(ME.commune || '')}" placeholder="اختر الولاية ثم البلدية"></label>
      <label>العنوان<input id="stAddress" value="${esc(ME.address || '')}" placeholder="العنوان (حي، شارع، معلم…)"></label>
      ${ME.role === 'supplier' ? `<label>اسم النشاط/المتجر<input id="stBusiness" value="${esc(ME.business_name || '')}" placeholder="اسم النشاط/المتجر"></label>` : ''}
      <label>معرّف تيليغرام الرقمي (اختياري — لإشعارات فورية)<input id="stTelegram" value="${esc(ME.telegram_chat_id || '')}" placeholder="مثال: 123456789"></label>
      <button class="btn" type="submit">حفظ بياناتي</button>
      <p class="muted small">البريد يُستعمل لاستعادة كلمة المرور — تأكد أنه بريد تصل إليه فعلاً.</p>
    </form>
  </div>
  ${ME.role === 'marketer' ? `<div class="card" id="sec-payinfo"><h3>💳 وسيلة استلام أرباحي</h3>
    <form id="payForm" class="stack">
      <label>وسيلة الاستلام<select id="stPayMethod">
        <option value="">— اختر وسيلة استلام أرباحك —</option>
        ${payMethods.map((m) => `<option ${ME.payment_method === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select></label>
      <label id="stPayDetailsLabel">تفاصيل الوسيلة<input id="stPayDetails" value="${esc(ME.payment_details || '')}" placeholder="تفاصيل الاستلام"></label>
      <button class="btn" type="submit">حفظ وسيلة الاستلام</button>
      <p class="muted small">بهذه الوسيلة والتفاصيل تدفع لك الإدارة أرباحك فعلياً خارج المنصة عند طلب السحب من محفظتك.</p>
    </form>
  </div>` : ''}
  <div class="card" id="sec-security"><h3>🔐 كلمة المرور والجلسات</h3>
    <form id="pwForm" class="stack">
      <label>كلمة المرور الحالية<input id="stPwCur" type="password" placeholder="كلمة المرور الحالية" autocomplete="current-password"></label>
      <label>كلمة المرور الجديدة<input id="stPwNew" type="password" placeholder="8 أحرف على الأقل" autocomplete="new-password"></label>
      <label>تأكيد الجديدة<input id="stPwNew2" type="password" placeholder="أعد كتابة الجديدة" autocomplete="new-password"></label>
      <button class="btn gold" type="submit">تغيير كلمة المرور</button>
    </form>
    <h4>جلساتي النشطة</h4>
    <div id="sessionsBox"><p class="muted small">جارٍ التحميل…</p></div>
  </div>`;
  const pmSel = $('#stPayMethod');
  if (pmSel) {
    const pmLabels = { 'تحويل بريدي موب': 'RIB بريدي موب (20 رقماً)', 'تحويل البريد الجاري': 'رقم الحساب البريدي الجاري والمفتاح (CCP)', 'التحصيل من مقر المنصة': 'الاسم الكامل ورقم هاتفك — الاستلام من مقر المنصة', 'Enveloppe': 'الاسم الكامل، العنوان، الهاتف', 'Flexy': 'رقم هاتفك Flexy', 'نقداً عند الاستلام من الإدارة': 'الاسم الكامل ورقم هاتفك' };
    const pmUpd = () => { const d = $('#stPayDetails'); if (d) d.placeholder = pmLabels[pmSel.value] || 'تفاصيل الاستلام'; };
    pmSel.addEventListener('change', pmUpd); pmUpd();
  }
  const pfW = $('#stWilaya');
  if (pfW) { pfW.addEventListener('change', () => fillCommunes(pfW.value)); if (pfW.value) fillCommunes(pfW.value); }
  $('#profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/me', { method: 'PATCH', body: { name: $('#stName').value, email: $('#stEmail').value, wilaya: $('#stWilaya').value, commune: $('#stCommune').value, address: $('#stAddress').value, businessName: $('#stBusiness') ? $('#stBusiness').value : undefined, telegramChatId: $('#stTelegram').value } });
      toast(r.message); await refreshMe(); renderDash();
    } catch (err) { toast(err.message, true); }
  });
  const payForm = $('#payForm');
  if (payForm) payForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/me', { method: 'PATCH', body: { paymentMethod: $('#stPayMethod').value, paymentDetails: $('#stPayDetails').value } });
      toast(r.message); await refreshMe(); renderDash();
    } catch (err) { toast(err.message, true); }
  });
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/me/password', { method: 'POST', body: { currentPassword: $('#stPwCur').value, password: $('#stPwNew').value, passwordConfirm: $('#stPwNew2').value } });
      toast(r.message); e.target.reset();
    } catch (err) { toast(err.message, true); }
  });
  api('/api/me/sessions').then(({ sessions }) => {
    const sb = $('#sessionsBox'); if (!sb) return;
    sb.innerHTML = sessions.length ? sessions.map((x) => `<p class="small">🖥️ جلسة بدأت ${new Date(x.created_at).toLocaleString('ar-DZ')} ${x.current ? '— <strong>هذه جلستك الحالية</strong>' : `<button class="btn small danger" data-revoke="${x.key}" type="button">إنهاء</button>`}</p>`).join('') : '<p class="muted small">لا جلسات.</p>';
    $$('#sessionsBox [data-revoke]').forEach((b) => b.addEventListener('click', async () => {
      try { await api('/api/me/sessions/' + b.dataset.revoke, { method: 'DELETE' }); toast('أُنهيت الجلسة'); renderSettings(); }
      catch (err) { toast(err.message, true); }
    }));
  }).catch(() => {});
}
function sectionNav() {
  const nav = $('#dashNav');
  const cards = $$('#dashContent > .card, #dashContent > .stat-grid');
  if (cards.length < 3) { nav.hidden = true; nav.innerHTML = ''; return; }
  nav.innerHTML = cards.map((c, i) => {
    if (!c.id) c.id = 'dsec-' + i;
    const title = c.classList.contains('stat-grid') ? '📊 نظرة عامة' : ((c.querySelector('h3') || {}).textContent || 'قسم ' + (i + 1)).trim();
    return `<button class="chip" data-sec="${c.id}" type="button">${esc(title)}</button>`;
  }).join('');
  nav.hidden = false;
  $$('#dashNav [data-sec]').forEach((b) => b.addEventListener('click', () => {
    const el = document.getElementById(b.dataset.sec);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); }
  }));
}
async function renderDash() {
  if (!ME) return openAuth('login');
  show('dash');
  renderSettings();
  const box = $('#dashContent');
  if (ME.role === 'buyer') await renderBuyer(box);
  else if (ME.role === 'marketer') await renderMarketer(box);
  else if (ME.role === 'supplier') await renderSupplier(box);
  else if (ME.role === 'admin') {
    // واجهة الإدارة منفصلة تماماً عن التطبيق العام — لا يظهر أي محتوى إداري هنا
    $('#dashSettings').innerHTML = '';
    box.innerHTML = `<div class="card" style="text-align:center;padding:34px 18px">
      <h3>🛠 واجهة الإدارة في صفحتها الخاصة</h3>
      <p class="muted">لحماية المنصة، لوحة الإدارة منفصلة عن هذا التطبيق العام ولا تظهر للمستخدمين.</p>
      <p><a class="btn gold big" href="/admin.html">فتح واجهة الإدارة</a></p>
    </div>`;
  }
  sectionNav();
}
async function renderBuyer(box) {
  const { orders } = await api('/api/my/orders');
  box.innerHTML = `<div class="card account-hub">
      <div class="hub-head"><span class="avatar-circle">${esc((ME.name || '؟').trim().charAt(0))}</span><div><strong>${esc(ME.name)}</strong><br><span class="muted small">حساب زبون${ME.wilaya ? ' · ' + esc(ME.wilaya) : ''}</span></div></div>
      <div class="menu-list">
        <button class="menu-row" id="hubOrders" type="button">🧾 طلباتي <span>‹</span></button>
        <button class="menu-row" id="hubSettings" type="button">⚙️ الإعدادات وعناويني <span>‹</span></button>
        <button class="menu-row" id="hubBell" type="button">🔔 الإشعارات <span>‹</span></button>
        <a class="menu-row" href="#" data-nav="contact">💬 المساعدة والدعم <span>‹</span></a>
        <a class="menu-row" href="#" data-nav="faq">❓ الأسئلة الشائعة <span>‹</span></a>
        <button class="menu-row" id="hubFav" type="button">❤️ المفضلة <span>‹</span></button>
        <button class="menu-row" id="hubLogout" type="button">🚪 تسجيل الخروج <span>‹</span></button>
      </div>
    </div>
    <div class="card" id="buyerOrders"><h3>طلباتي</h3>${orders.length ? `<div class="tablewrap"><table class="rt">
    <tr><th>الرقم</th><th>الحالة</th><th>الإجمالي</th><th>التاريخ</th><th></th></tr>
    ${orders.map((o) => `<tr><td data-l="الرقم">${esc(o.ref)}</td><td data-l="الحالة">${esc(o.status_label)}</td><td data-l="الإجمالي">${fmt(o.total)}</td><td data-l="التاريخ">${new Date(o.created_at).toLocaleDateString('ar-DZ')}</td>
    <td data-l=""><button class="btn small light" data-details="${o.id}">📋 التفاصيل</button> <button class="btn small" data-reorder="${o.id}">🔁 اطلب مجدداً</button> ${o.status === 'pending_supplier' ? `<button class="btn small danger" data-cancel="${o.id}">إلغاء</button>` : ''}</td></tr>`).join('')}</table></div>` : '<p class="muted">لا توجد طلبات بعد.</p>'}</div>`;
  const hub = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
  hub('#hubOrders', () => $('#buyerOrders').scrollIntoView({ behavior: 'smooth' }));
  hub('#hubSettings', () => $('#dashSettings').scrollIntoView({ behavior: 'smooth' }));
  hub('#hubBell', () => $('#bellBtn').click());
  hub('#hubFav', () => { if (!FAV_ONLY) $('#favToggle').click(); show('home'); document.getElementById('products').scrollIntoView({ behavior: 'smooth' }); });
  hub('#hubLogout', () => $('#logoutBtn').click());
  $$('#dashContent [data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/my/orders/${b.dataset.cancel}/cancel`, { method: 'POST', body: {} }); toast('أُلغي الطلب'); renderDash(); }
    catch (e) { toast(e.message, true); }
  }));
}
const COMM_STATE_AR = (c, orderStatus) => c.state === 'paid' ? 'مدفوعة ✅' : c.state === 'payable' ? 'موافق عليها 💰' : c.state === 'cancelled' ? 'ملغاة' : (['handed', 'out_for_delivery'].includes(orderStatus) ? 'في التوصيل 🚚' : 'قيد الانتظار ⏳');
async function renderMarketer(box) {
  const [{ products }, { commissions, settlements }, { orders }, { wallet }, invite, { requests: payoutReqs }] = await Promise.all([
    api('/api/marketer/products'), api('/api/marketer/commissions'), api('/api/marketer/orders'), api('/api/my/wallet'), api('/api/my/invite'), api('/api/my/payout-requests')
  ]);
  const commByRef = Object.fromEntries(commissions.map((c) => [c.ref, c]));
  const orderStatusByRef = Object.fromEntries(orders.map((o) => [o.ref, o.status]));
  const invLink = location.origin + '/?inv=' + invite.code;
  box.innerHTML = `
  <div class="grid" style="margin-bottom:14px">
    <div class="card stat-card"><span class="stat-ic">🧾</span><strong>${orders.length}</strong><span>كل الطلبات</span><small>إجمالي طلبيات زبائنك</small></div>
    <div class="card stat-card"><span class="stat-ic">🚚</span><strong>${orders.filter((o) => ['pending_supplier', 'confirmed', 'preparing', 'handed', 'out_for_delivery'].includes(o.status)).length}</strong><span>قيد التوصيل</span><small>الطلبات التي لم تُسلّم بعد</small></div>
    <div class="card stat-card"><span class="stat-ic">✅</span><strong>${orders.filter((o) => o.status === 'delivered_collected').length}</strong><span>تم التسليم</span><small>الطلبات المستلمة بنجاح</small></div>
    <div class="card stat-card"><span class="stat-ic">💰</span><strong>${fmt(wallet.earned)}</strong><span>إجمالي أرباحي</span><small>كل عمولاتي ومكافآتي (نفس رقم المحفظة)</small></div>
  </div>
  <div class="card"><h3>📍 مراحل تتبّع كل طلب</h3><div class="stages-strip">${['طلب جديد', 'تم تأكيد الطلب', 'قيد التجهيز لدى المورد', 'تم تسليمه لشركة التوصيل', 'خرج للتوصيل', 'تم التسليم أو الإرجاع أو الإلغاء'].map((t, i) => `<div class="stage-pill"><b>${i + 1}</b><span>${t}</span></div>`).join('')}</div></div>
  <div class="card" id="sec-wallet"><h3>💰 محفظتي</h3>
    <div class="stat-grid">
      <div class="stat">إجمالي أرباحي<b>${fmt(wallet.earned)}</b></div>
      <div class="stat">طلبات جلبتها<b>${orders.length}</b></div>
      <div class="stat">مكافآت الدعوات 🎁<b>${fmt(wallet.bonuses)}</b></div>
    </div>
    <div class="wallet-hero">
      <span class="small" style="opacity:.85">💳 الرصيد القابل للسحب الآن</span>
      <div class="wh-amount">${fmt(wallet.balance)}</div>
      <span class="small" style="opacity:.9">وسيلة استلامي: ${ME.payment_method ? esc(ME.payment_method) + (ME.payment_details ? ' — ' + esc(ME.payment_details) : '') : 'لم تُضبط بعد — اضبطها في «وسيلة استلام أرباحي» أسفل الصفحة (CCP / بريدي موب / Flexy)'}</span>
    </div>
    <div class="tiles">
      <div class="tile blue"><small>عمولة في توصيل</small><b>${fmt(wallet.inDelivery)}</b></div>
      <div class="tile green"><small>عمولة قيد الانتظار</small><b>${fmt(wallet.waiting)}</b></div>
      <div class="tile teal"><small>عمولة موافق عليها</small><b>${fmt(wallet.approved)}</b></div>
      ${wallet.requested ? `<div class="tile orange"><small>قيد السحب الآن</small><b>${fmt(wallet.requested)}</b></div>` : ''}
      <div class="tile purple"><small>عمولة مدفوعة</small><b>${fmt(wallet.paid)}</b></div>
    </div>
    ${(() => { const pend = payoutReqs.find((r) => r.state === 'pending'); return pend ? `<div class="status-banner good">📨 عندك طلب سحب قيد المعالجة: #${pend.id} — ${fmt(pend.amount)} عبر ${esc(pend.method)} — منذ ${new Date(pend.created_at).toLocaleDateString('ar-DZ')}</div>` : ''; })()}
    <form id="payoutForm" class="stack" style="margin-top:12px">
      <h4>💸 طلب سحب الأرباح</h4>
      <label>المبلغ (دج)<input id="poAmount" type="number" min="1" value="${wallet.balance || ''}" placeholder="المبلغ المطلوب سحبه"></label>
      <label>وسيلة السحب<select id="poMethod">${['تحويل بريدي موب', 'تحويل البريد الجاري', 'التحصيل من مقر المنصة', 'Enveloppe', 'Flexy', 'نقداً عند الاستلام من الإدارة'].map((m) => `<option ${ME.payment_method === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label>تفاصيل الوسيلة<input id="poDetails" value="${esc(ME.payment_details || '')}" placeholder="رقم الحساب / الهاتف المرتبط بالوسيلة"></label>
      <button class="btn gold" type="submit" ${wallet.balance > 0 ? '' : 'disabled'}>إرسال طلب السحب</button>
      <p class="muted small">الدفع الفعلي يتم خارج المنصة بوسيلتك (بريدي موب / CCP / Flexy…) — تُعالج الإدارة طلبك وتوثّق الدفع هنا بالطريقة ومرجع العملية. العمولة لا تتجزأ: قد يُعدَّل المبلغ ليطابق عمولاتك كاملة ويظهر لك رقمه النهائي.</p>
    </form>
    ${payoutReqs.length ? `<h4>📨 طلبات سحبي</h4>${payoutReqs.slice(0, 5).map((r) => `<div class="po-row"><div class="po-top"><b>#${r.id} — ${fmt(r.amount)}</b><span class="muted small">${new Date(r.created_at).toLocaleDateString('ar-DZ')}</span></div><div class="small">${r.state === 'pending' ? 'قيد المعالجة ⏳' : r.state === 'paid' ? `مدفوع ✅ عبر ${esc(r.admin_method || r.method)}${r.admin_reference ? ' · مرجع: ' + esc(r.admin_reference) : ''}` : 'مرفوض ❌' + (r.admin_note ? ' — ' + esc(r.admin_note) : '')}</div></div>`).join('')}` : ''}
    ${(() => { const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i)); const sum = commissions.filter((c) => c.state !== 'cancelled' && new Date(c.created_at) >= d && new Date(c.created_at) < new Date(d.getTime() + 86400e3)).reduce((a, c) => a + c.amount, 0); return { d, sum }; }); const max = Math.max(1, ...days.map((x) => x.sum)); return `<h4>📈 أداء المبيعات — آخر 7 أيام</h4><div style="display:flex;gap:6px;align-items:flex-end;height:90px">${days.map((x) => `<div style="flex:1;text-align:center"><div title="${fmt(x.sum)}" style="background:var(--gold);border-radius:6px 6px 0 0;height:${Math.max(4, Math.round(x.sum / max * 56))}px"></div><span class="muted" style="font-size:10px;white-space:nowrap;display:block">${x.d.toLocaleDateString('ar-DZ', { weekday: 'short' })}</span><br><span class="small">${x.sum ? fmt(x.sum) : '—'}</span></div>`).join('')}</div>`; })()}
    <h4>🧾 سجل المدفوعات الموثّقة</h4>
    ${settlements.length ? settlements.map((s) => `<p>#${s.id} — ${fmt(s.amount)} — مدفوعة ✅${s.method ? ' · ' + esc(s.method) : ''}${s.reference ? ' · مرجع: ' + esc(s.reference) : ''} <span class="muted small">${new Date(s.created_at).toLocaleDateString('ar-DZ')}</span></p>`).join('') : '<p class="muted small">لا مدفوعات موثّقة بعد — أول دفعة تصلك خارج المنصة تظهر هنا بطريقتها ومرجعها.</p>'}
  </div>
  <div class="card"><h3>📋 قائمة حسابي</h3>
    <div class="menu-list">
      <a class="menu-row" href="#dashSettings" id="mkProfile">👤<span>الملف الشخصي</span>‹</a>
      <a class="menu-row" href="#" id="mkFav">❤️<span>المفضلة</span>‹</a>
      <a class="menu-row" href="#sec-orders">🧾<span>طلباتي</span>‹</a>
      <a class="menu-row" href="#sec-wallet">💳<span>المدفوعات</span>‹</a>
      <a class="menu-row" href="#" data-nav="delivery">🚚<span>سعر التوصيل</span>‹</a>
      <a class="menu-row" href="#" data-nav="training">🎓<span>تدريب</span>‹</a>
      <a class="menu-row" href="#" data-nav="faq">❓<span>الأسئلة الشائعة</span>‹</a>
      <a class="menu-row" href="#sec-invite">🎁<span>ادعو أصدقائك</span>‹</a>
      <button class="menu-row" id="mkLogout" type="button">🚪<span>تسجيل الخروج</span>‹</button>
    </div>
  </div>
  <div class="card"><h3>منتجات متاحة للتسويق</h3>
    <p class="muted small">عمولتك <strong>حسب اختيارك</strong>: السعر المعروض هو السعر الأساسي، حدّد سعر بيعك عند إدخال طلب الزبون في السلة وربحك هو الفرق (5% على الأقل). انسخ الوصف بلا سعر وأضف سعرك أنت في إعلانك.</p>
    <input id="mkProdSearch" placeholder="🔍 ابحث باسم المنتج أو القسم…" style="margin-bottom:10px">
    <div class="tablewrap"><table class="rt" id="mkProdTable">
    <tr><th>المنتج</th><th>السعر الأساسي</th><th>المخزون</th><th>مواد التسويق اليدوي</th></tr>
    ${products.map((p, i) => `<tr data-mkrow data-name="${esc((p.name + ' ' + (p.category_name || '')).toLowerCase())}" ${i >= 40 ? 'hidden' : ''}><td data-l="المنتج"><span class="mk-thumb">${p.images && p.images.length ? `<img src="${esc(p.images[0])}" alt="" loading="lazy">` : '📦'}</span> ${esc(p.name)}${p.category_name ? `<br><span class="muted small">${esc(p.category_name)}</span>` : ''}</td><td data-l="السعر الأساسي">${fmt(p.customer_price)}</td>
      <td data-l="المخزون">${p.stock > 0 ? p.stock : '<span class="badge out">نافد</span>'}</td>
      <td data-l="أدوات"><button class="btn small light" data-copydesc="${p.id}">📋 نسخ الوصف</button> <button class="btn small light" data-view="${p.id}">👁️ عرض وحفظ الصور</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">لا منتجات معتمدة بعد</td></tr>'}</table></div>
    ${products.length > 40 ? `<button class="btn light" id="mkShowAll" type="button">عرض كل المنتجات (${products.length})</button>` : ''}
    <p class="muted small" id="mkProdCount"></p>
  </div>
  <div class="card" id="sec-orders"><h3>طلباتي وحالات أرباحها</h3>${orders.length ? `<div class="chip-row" id="mkOrderChips"><button class="chip on" data-ofilter="all" type="button">الكل</button><button class="chip" data-ofilter="progress" type="button">قيد التوصيل</button><button class="chip" data-ofilter="delivered" type="button">تم التسليم</button><button class="chip" data-ofilter="bad" type="button">ملغاة / مرتجعة</button></div><div class="tablewrap"><table class="rt"><tr><th>الرقم</th><th>حالة الطلب</th><th>الإجمالي</th><th>عمولتي</th><th>حالة العمولة</th><th></th></tr>${orders.map((o) => { const c = commByRef[o.ref]; return `<tr data-ostatus="${o.status}"><td data-l="الرقم">${esc(o.ref)}</td><td data-l="حالة الطلب">${esc(o.status_label)}</td><td data-l="الإجمالي">${fmt(o.total)}</td><td data-l="عمولتي">${c ? fmt(c.amount) : '—'}</td><td data-l="حالة العمولة">${c ? COMM_STATE_AR(c, o.status) : '—'}</td><td data-l=""><button class="btn small light" data-details="${o.id}">📋 التفاصيل</button></td></tr>`; }).join('')}</table></div>` : '<p class="muted">لا طلبات بعد.</p>'}</div>
  <div class="card" id="sec-invite"><h3>🎁 ادعو أصدقائك</h3>
    <p>ادعُ أصدقاءك للانضمام كمسوقين: عندما تبلغ الأرباح المؤكدة لأي صديق دعوتَه <strong>5000 دج</strong>، تربح أنت مكافأة <strong>500 دج</strong> تُضاف إلى رصيدك.</p>
    <p>رابط دعوتك: <code>${invLink}</code> <button class="btn small" id="copyInv" type="button">نسخ الرابط</button>
    <a class="btn small light" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('انضم معي لمسوّقي SOUQAR واربح من التسويق بالعمولة: ' + invLink)}">مشاركة واتساب</a>
    <a class="btn small light" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(invLink)}">مشاركة فيسبوك</a></p>
    <p>أصدقاء انضموا بدعوتك: <strong>${invite.invitedCount}</strong> · مكافآت ربحتها: <strong>${fmt(invite.bonusesEarned)}</strong></p>
    ${invite.invited.length ? invite.invited.map((u) => `<p class="small">${esc(u.name)} — أرباحه المؤكدة: ${fmt(u.earned)}${u.bonusPaid ? ' — 🎉 جلب لك ' + fmt(u.bonusPaid) : ' — بقي له ' + fmt(u.remaining) + ' ليجلب لك 500 دج'}</p>`).join('') : '<p class="muted small">لا مدعوين بعد — شارك رابطك وابدأ.</p>'}
  </div>`;
  $$('#mkOrderChips .chip').forEach((ch) => ch.addEventListener('click', () => {
    $$('#mkOrderChips .chip').forEach((x) => x.classList.toggle('on', x === ch));
    const f = ch.dataset.ofilter;
    $$('#sec-orders tr[data-ostatus]').forEach((tr) => {
      const st = tr.dataset.ostatus;
      const show = f === 'all' || (f === 'progress' && ['pending_supplier', 'confirmed', 'preparing', 'handed', 'out_for_delivery'].includes(st)) || (f === 'delivered' && st === 'delivered_collected') || (f === 'bad' && ['cancelled', 'rejected', 'returned', 'failed_delivery'].includes(st));
      tr.style.display = show ? '' : 'none';
    });
  }));
  const poForm = $('#payoutForm');
  if (poForm) poForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/my/payout-requests', { method: 'POST', body: { amount: Number($('#poAmount').value), method: $('#poMethod').value, details: $('#poDetails').value } });
      toast(`${r.message} المبلغ الفعلي للطلب: ${fmt(r.amount)}`);
      renderDash();
    } catch (err) { toast(err.message, true); }
  });
  const mkSearch = $('#mkProdSearch');
  if (mkSearch) mkSearch.addEventListener('input', () => {
    const q = mkSearch.value.trim().toLowerCase();
    let shown = 0;
    $$('#mkProdTable [data-mkrow]').forEach((tr) => { const hit = !q || tr.dataset.name.includes(q); tr.hidden = q ? !hit : tr.hidden && shown >= 40 ? true : false; if (!tr.hidden) shown++; });
    if (!q) { let n = 0; $$('#mkProdTable [data-mkrow]').forEach((tr) => { tr.hidden = n >= 40; if (!tr.hidden) n++; }); shown = n; const sa = $('#mkShowAll'); if (sa) sa.hidden = false; }
    const cnt = $('#mkProdCount'); if (cnt) cnt.textContent = q ? `نتائج البحث: ${shown}` : '';
  });
  const mkAll = $('#mkShowAll');
  if (mkAll) mkAll.addEventListener('click', () => { $$('#mkProdTable [data-mkrow]').forEach((tr) => { tr.hidden = false; }); mkAll.hidden = true; });
  $$('#dashContent [data-copydesc]').forEach((b) => b.addEventListener('click', async () => {
    const p = products.find((x) => x.id === Number(b.dataset.copydesc));
    const txt = `${p.name}\n${p.description || ''}\n✅ الدفع عند الاستلام — للطلب والاستفسار راسلني`;
    const ok = await copyText(txt);
    if (ok) toast('نُسخ الوصف بلا سعر — أضف سعرك أنت في إعلانك');
    else toast('تعذّر النسخ التلقائي — افتح المنتج وانسخ وصفه يدوياً', true);
  }));
  $$('#dashContent [data-view]').forEach((b) => b.addEventListener('click', () => openProduct(Number(b.dataset.view))));
  const ci = $('#copyInv');
  if (ci) ci.addEventListener('click', async () => { const ok = await copyText(invLink); toast(ok ? 'نُسخ رابط الدعوة' : 'تعذّر النسخ — انسخ الرابط يدوياً', !ok); });
  const mkp = $('#mkProfile');
  if (mkp) mkp.addEventListener('click', (e) => { e.preventDefault(); $('#dashSettings').scrollIntoView({ behavior: 'smooth' }); });
  const ml = $('#mkLogout');
  if (ml) ml.addEventListener('click', () => { const lb = $('#logoutBtn'); if (lb) lb.click(); });
  const mf = $('#mkFav');
  if (mf) mf.addEventListener('click', (e) => { e.preventDefault(); if (!FAV_ONLY) $('#favToggle').click(); show('home'); document.getElementById('products').scrollIntoView({ behavior: 'smooth' }); });
}
async function renderSupplier(box) {
  const [{ products }, { orders }, { coverage }, reports, { categories }] = await Promise.all([
    api('/api/supplier/products'), api('/api/supplier/orders'), api('/api/supplier/coverage'), api('/api/supplier/reports'), api('/api/categories')
  ]);
  const covMap = Object.fromEntries(coverage.map((c) => [c.wilaya_code, c]));
  box.innerHTML = `
  <div class="card account-hub">
    <div class="hub-head"><span class="avatar-circle">${esc((ME.business_name || ME.name || 'م').trim().charAt(0))}</span><div><strong>${esc(ME.business_name || ME.name)}</strong><br><span class="muted small">🏭 متجر مورّد${ME.wilaya ? ' · ' + esc(ME.wilaya) : ''} · <span id="supFollowers">…</span> متابِع</span></div></div>
    <div class="join-row"><button class="btn gold" id="supStoreBtn" type="button">🏪 عرض متجري العام</button><a class="btn light" href="#supOrdersSec">🧾 الطلبات الواردة</a><a class="btn light" href="#supCovSec">🚚 أسعار التوصيل</a></div>
  </div>
  <div class="grid" style="margin-bottom:14px">
    <div class="card stat-card"><span class="stat-ic">💰</span><strong>${fmt(reports.delivered.sum)}</strong><span>مبيعاتي المسلّمة</span><small>${reports.delivered.c || 0} طلباً محصّلاً</small></div>
    <div class="card stat-card"><span class="stat-ic">🆕</span><strong>${orders.filter((o) => o.status === 'pending_supplier').length}</strong><span>طلبات جديدة</span><small>بانتظار تأكيدك</small></div>
    <div class="card stat-card"><span class="stat-ic">⚙️</span><strong>${orders.filter((o) => ['confirmed', 'preparing', 'handed', 'out_for_delivery'].includes(o.status)).length}</strong><span>قيد المعالجة</span><small>مؤكدة أو في التوصيل</small></div>
    <div class="card stat-card"><span class="stat-ic">✅</span><strong>${orders.filter((o) => o.status === 'delivered_collected').length}</strong><span>تم التسليم</span><small>طلبات مكتملة</small></div>
    <div class="card stat-card"><span class="stat-ic">📦</span><strong>${products.length}</strong><span>منتجاتي</span><small>${products.filter((p) => p.status === 'approved').length} معتمداً معروضاً</small></div>
    <div class="card stat-card"><span class="stat-ic">⚠️</span><strong>${reports.lowStock.length}</strong><span>تنبيه مخزون</span><small>منتجات قاربت النفاد</small></div>
  </div>
  ${ME.status !== 'active' ? '<div class="card"><p>⏳ حسابك قيد مراجعة الإدارة — ستتمكن من النشر واستقبال الطلبات بعد التفعيل.</p></div>' : ''}
  <div class="card"><h3>🕐 آخر النشاطات</h3>${orders.length ? orders.slice(0, 5).map((o) => `<div class="prod-row"><div class="pr-main"><strong>${esc(o.ref)}</strong> <span class="badge">${esc(o.status_label)}</span><br><span class="muted small">${esc(o.guest_name || '')} · ${wilayaName(o.wilaya)} · ${new Date(o.created_at).toLocaleDateString('ar-DZ')}</span></div><strong>${fmt(o.total)}</strong><button class="btn small light" data-details="${o.id}">التفاصيل</button></div>`).join('') : '<p class="muted">لا نشاط بعد — أول طلب يصلك يظهر هنا.</p>'}</div>
  <div class="card"><h3>إضافة منتج</h3>
    <form id="prodForm" class="stack">
      <input id="pfName" placeholder="اسم المنتج" required>
      <textarea id="pfDesc" placeholder="الوصف الكامل"></textarea>
      <div class="row-form">
        <input id="pfWholesale" type="number" min="0" placeholder="سعر الجملة (دج)" required>
        <input id="pfStock" type="number" min="0" placeholder="المخزون" required>
        <select id="pfCat"><option value="">تصنيف…</option>${categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      </div>
      <input id="pfCompare" type="number" min="0" placeholder="السعر قبل التخفيض (اختياري — يظهر مشطوباً مع نسبة خصم بجنب سعرك النهائي)">
      <div class="row-form"><input id="pfSizes" placeholder="المقاسات مفصولة بفواصل (اختياري)"><input id="pfColors" placeholder="الألوان مفصولة بفواصل (اختياري)"></div>
      <label>صور المنتج (حتى 6 — تحميل من جهازك أو روابط)</label>
      <input id="pfFiles" type="file" accept="image/*" multiple>
      <input id="pfImgUrls" placeholder="روابط صور إضافية مفصولة بفواصل (اختياري)">
      <div class="gallery" id="pfPreview"></div>
      <button class="btn gold" type="submit">إرسال المنتج لمراجعة الإدارة</button>
      <p class="muted small">سعر الزبون = سعر الجملة + هامش المنصة الذي تحدده الإدارة عند الاعتماد. المنتج لا يظهر قبل الاعتماد.</p>
    </form></div>
  <div class="card" id="supProductsSec"><h3>منتجاتي</h3>${products.length ? products.map((p) => `
    <div class="prod-row">
      ${p.images && p.images.length ? `<img src="${esc(p.images[0])}" alt="">` : '<span class="cc-img cc-emoji" style="width:56px;height:56px;border-radius:12px">📦</span>'}
      <div class="pr-main"><strong dir="auto">${esc(p.name)}</strong><br>
      <span class="muted small">الجملة ${fmt(p.wholesale_price)} · هامش المنصة ${fmt(p.platform_margin)} · سعر الزبون <strong style="color:#0d9d63">${fmt(p.customer_price)}</strong> · المخزون ${p.stock}</span><br>
      <span class="badge">${({ pending_review: 'بانتظار المراجعة', approved: 'معتمد', rejected: 'مرفوض', paused: 'موقوف' })[p.status] || p.status}</span>${p.status === 'rejected' && p.reject_reason ? ' <span class="small">' + esc(p.reject_reason) + '</span>' : ''} <span class="muted small">عمولة المسوق: حسب اختياره</span></div>
      ${p.status === 'approved' ? `<button class="btn small light" data-pause="${p.id}">إيقاف مؤقت</button>` : ''}${p.status === 'paused' ? `<button class="btn small" data-resume="${p.id}">إعادة تفعيل</button>` : ''}
      <button class="btn small light" data-edit="${p.id}">✏️ تعديل</button>
    </div>`).join('') : '<p class="muted">لا منتجات بعد.</p>'}</div>
  <div class="card" id="supOrdersSec"><h3>طلباتي الواردة <a class="btn small light" href="/api/supplier/export/orders.csv" style="float:left">⬇️ تصدير CSV</a></h3>
    ${orders.length ? `<div class="chip-row" id="supOrderChips"><button class="chip on" data-ofilter="all" type="button">الكل</button><button class="chip" data-ofilter="new" type="button">جديدة</button><button class="chip" data-ofilter="progress" type="button">قيد المعالجة</button><button class="chip" data-ofilter="delivered" type="button">تم التسليم</button><button class="chip" data-ofilter="bad" type="button">ملغاة / مرتجعة</button></div>` + orders.map((o) => `
    <div class="ord-card" data-ostatus="${o.status}">
      <div class="ord-head"><strong>${esc(o.ref)}</strong><span class="badge">${esc(o.status_label)}</span><strong style="color:#0d9d63">${fmt(o.total)}</strong></div>
      <p class="small" style="margin:7px 0">👤 ${esc(o.guest_name || '')} (${esc(o.guest_phone || '')}) · 📍 ${wilayaName(o.wilaya)} / ${esc(o.commune)} — ${esc(o.address)}</p>
      <p class="small muted" style="margin:4px 0">${o.items.map((i) => `${esc(i.name)} × ${i.qty} — ${fmt(i.customer_price * i.qty)}`).join('<br>')}</p>
      <p class="muted small">التوصيل: ${fmt(o.delivery_fee)}${o.reject_reason ? ' · سبب الرفض: ' + esc(o.reject_reason) : ''}</p>
      <p><button class="btn small light" data-details="${o.id}">📋 التفاصيل الكاملة والخط الزمني</button></p>
      <div class="row-form">
        <button class="btn small light" data-contact="answered" data-oid="${o.id}">📞 اتصلت: ردّ وأكّد</button>
        <button class="btn small light" data-contact="no_answer" data-oid="${o.id}">📞 لا يرد</button>
        <button class="btn small light" data-contact="wrong_number" data-oid="${o.id}">📞 رقم خاطئ</button>
        <button class="btn small light" data-contact="postponed" data-oid="${o.id}">📞 طلب تأجيل</button>
      </div>
      <div class="row-form">
        <select id="st-${o.id}">${STATUS_FLOW.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${STATUS_AR[s]}</option>`).join('')}</select>
        <input id="rs-${o.id}" placeholder="سبب (إلزامي عند الرفض/الإلغاء)">
        <input id="sh-${o.id}" placeholder="رقم تتبع الشحنة (اختياري)" value="${esc(o.ship_ref || '')}">
        <button class="btn small" data-status="${o.id}">تحديث الحالة</button>
      </div>
    </div>`).join('') : '<p class="muted">لا طلبات بعد.</p>'}</div>
  <div class="card" id="supCovSec"><h3>تغطية الولايات وتكلفة التوصيل</h3>
    <p class="muted small">فعّل الولايات التي تغطيها وحدد لكل واحدة: سعر التوصيل <strong>للمنزل</strong>، سعر التوصيل <strong>للمكتب</strong> (اختياري)، ومدة التوصيل (مثال: 24–48 ساعة). الطلبات إلى ولايات غير مغطاة تُرفض آلياً.</p>
    <form id="covForm"><div class="kv">${WILAYAS.map((w) => { const c = covMap[w.code]; return `<label class="check"><input type="checkbox" data-cov="${w.code}" ${c ? 'checked' : ''}> ${w.code} — ${esc(w.name_ar)} <input type="number" min="0" data-fee="${w.code}" value="${c ? c.delivery_fee : ''}" placeholder="منزل دج" style="width:95px"> <input type="number" min="0" data-feeoffice="${w.code}" value="${c && c.fee_office != null ? c.fee_office : ''}" placeholder="مكتب دج" style="width:95px"> <input data-dur="${w.code}" value="${c && c.duration ? esc(c.duration) : ''}" placeholder="المدة" style="width:110px"></label>`; }).join('')}</div>
    <button class="btn gold" type="submit" style="margin-top:10px">حفظ التغطية</button></form></div>`;
  let uploaded = [];
  $('#pfFiles').addEventListener('change', async (e) => {
    uploaded = [];
    for (const f of [...e.target.files].slice(0, 6)) {
      const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      try { const up = await api('/api/upload', { method: 'POST', body: { dataUrl } }); uploaded.push(up.url); }
      catch (err) { toast('صورة لم تُرفع: ' + err.message, true); }
    }
    $('#pfPreview').innerHTML = uploaded.map((u) => `<img src="${esc(u)}" alt="">`).join('') + (uploaded.length ? `<span class="muted">${uploaded.length}/6 صور مرفوعة</span>` : '');
  });
  let editingId = null;
  $$('#dashContent [data-edit]').forEach((b) => b.addEventListener('click', () => {
    const p = products.find((x) => x.id === Number(b.dataset.edit));
    if (!p) return;
    editingId = p.id;
    $('#pfName').value = p.name; $('#pfDesc').value = p.description || '';
    $('#pfWholesale').value = p.wholesale_price; $('#pfStock').value = p.stock;
    $('#pfCompare').value = p.compare_price || '';
    $('#pfCat').value = p.category_id || '';
    $('#pfSizes').value = (p.sizes || []).join('، '); $('#pfColors').value = (p.colors || []).join('، ');
    $('#pfImgUrls').value = (p.images || []).join(', ');
    uploaded = [];
    $('#pfPreview').innerHTML = (p.images || []).map((u) => `<img src="${esc(u)}" alt="">`).join('');
    const h = $('#prodForm').closest('.card').querySelector('h3');
    if (h) h.textContent = '✏️ تعديل منتج: ' + p.name;
    const submit = $('#prodForm button[type="submit"]');
    if (submit) submit.textContent = 'حفظ التعديلات';
    $('#prodForm').scrollIntoView({ behavior: 'smooth' });
    toast('وضع التعديل — عدّل ثم اضغط «حفظ التعديلات» (تغيير الاسم أو السعر يعيد المنتج لمراجعة الإدارة، والمخزون وحده لا يعيده)');
  }));
  $$('#dashContent [data-contact]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/supplier/orders/${b.dataset.oid}/contact`, { method: 'POST', body: { result: b.dataset.contact } }); toast('وُثّق الاتصال في سجل الطلب'); }
    catch (e) { toast(e.message, true); }
  }));
  $('#prodForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const urls = $('#pfImgUrls').value.split(',').map((s) => s.trim()).filter(Boolean);
    const body = {
      name: $('#pfName').value, description: $('#pfDesc').value,
      wholesalePrice: Number($('#pfWholesale').value), stock: Number($('#pfStock').value),
      comparePrice: $('#pfCompare').value ? Number($('#pfCompare').value) : undefined,
      categoryId: $('#pfCat').value ? Number($('#pfCat').value) : null,
      sizes: $('#pfSizes').value.split(/[,،]/).map((s) => s.trim()).filter(Boolean),
      colors: $('#pfColors').value.split(/[,،]/).map((s) => s.trim()).filter(Boolean),
      images: [...uploaded, ...urls].slice(0, 6)
    };
    try {
      if (editingId) { await api('/api/supplier/products/' + editingId, { method: 'PUT', body }); toast('حُفظت تعديلات المنتج'); }
      else { const r = await api('/api/supplier/products', { method: 'POST', body }); toast(r.message); }
      renderDash();
    } catch (err) { toast(err.message, true); }
  });
  $$('#dashContent [data-status]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.status;
    try { await api(`/api/supplier/orders/${id}/status`, { method: 'POST', body: { status: $('#st-' + id).value, reason: $('#rs-' + id).value, shipRef: $('#sh-' + id) ? $('#sh-' + id).value : '' } }); toast('حُدّثت حالة الطلب'); renderDash(); }
    catch (e) { toast(e.message, true); }
  }));
  $$('#dashContent [data-pause]').forEach((b) => b.addEventListener('click', async () => { await togglePause(Number(b.dataset.pause), true); }));
  $$('#dashContent [data-resume]').forEach((b) => b.addEventListener('click', async () => { await togglePause(Number(b.dataset.resume), false); }));
  async function togglePause(id, paused) {
    const p = products.find((x) => x.id === id);
    try { await api('/api/supplier/products/' + id, { method: 'PUT', body: { name: p.name, wholesalePrice: p.wholesale_price, stock: p.stock, description: p.description, categoryId: p.category_id, sizes: p.sizes, colors: p.colors, images: p.images, paused } }); renderDash(); }
    catch (e) { toast(e.message, true); }
  }
  const ssb = $('#supStoreBtn');
  if (ssb) ssb.addEventListener('click', () => openStore(ME.id));
  api('/api/suppliers/' + ME.id + '/follow').then((f) => { const el = $('#supFollowers'); if (el) el.textContent = f.followers; }).catch(() => { const el = $('#supFollowers'); if (el) el.textContent = '0'; });
  $$('#supOrderChips .chip').forEach((ch) => ch.addEventListener('click', () => {
    $$('#supOrderChips .chip').forEach((x) => x.classList.toggle('on', x === ch));
    const f = ch.dataset.ofilter;
    $$('#supOrdersSec .ord-card').forEach((card) => {
      const st = card.dataset.ostatus;
      const show = f === 'all' || (f === 'new' && st === 'pending_supplier') || (f === 'progress' && ['confirmed', 'preparing', 'handed', 'out_for_delivery'].includes(st)) || (f === 'delivered' && st === 'delivered_collected') || (f === 'bad' && ['cancelled', 'rejected', 'returned', 'failed_delivery'].includes(st));
      card.style.display = show ? '' : 'none';
    });
  }));
  $('#covForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const coverage = $$('#covForm [data-cov]:checked').map((cb) => ({ wilaya_code: Number(cb.dataset.cov), delivery_fee: Number($(`#covForm [data-fee="${cb.dataset.cov}"]`).value) || 0, fee_office: $(`#covForm [data-feeoffice="${cb.dataset.cov}"]`).value === '' ? null : Number($(`#covForm [data-feeoffice="${cb.dataset.cov}"]`).value), duration: $(`#covForm [data-dur="${cb.dataset.cov}"]`).value || null }));
    try { await api('/api/supplier/coverage', { method: 'PUT', body: { coverage } }); toast('حُفظت تغطية التوصيل'); }
    catch (err) { toast(err.message, true); }
  });
}


// ---------- أحداث عامة ----------
function openAuth(tab = 'login', role, phone) {
  show('auth');
  $$('[data-authtab]').forEach((t) => t.classList.toggle('active', t.dataset.authtab === tab));
  $('#pane-login').hidden = tab !== 'login';
  $('#pane-register').hidden = tab !== 'register';
  $('#pane-forgot').hidden = tab !== 'forgot';
  if (role) selectRole(role);
}
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { e.preventDefault(); const k = nav.dataset.nav; if (k === 'home') show('home'); else if (k === 'track') openTrack(); else openPage(k); }
});
{ const tg = document.getElementById('tgLink'); if (tg) tg.href = 'https://t.me/share/url?url=' + encodeURIComponent(location.origin + '/') + '&text=' + encodeURIComponent('SOUQAR — سوق واحد، تجارة تجمع الجميع'); }
$('#authBtn').addEventListener('click', () => openAuth('login'));
$('#joinMarketer').addEventListener('click', () => openAuth('register', 'marketer'));
$('#dashBtn').addEventListener('click', renderDash);
$('#logoutBtn').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {}); ME = null; CSRF = null; await refreshMe(); show('home'); toast('تم تسجيل الخروج'); });
$$('[data-authtab]').forEach((t) => t.addEventListener('click', () => openAuth(t.dataset.authtab)));
$$('.role-tabs .tab').forEach((t) => t.addEventListener('click', () => selectRole(t.dataset.role)));
$('#cartBtn').addEventListener('click', async () => { $('#cartDrawer').hidden = false; await renderCart(); });
$('#accountBtn').addEventListener('click', () => { if (ME) renderDash(); else openAuth('login'); });
// شريط التنقل السفلي (الجوال) كيما نموذج التطبيق
$$('#mobileNav [data-mnav]').forEach((b) => b.addEventListener('click', async () => {
  const k = b.dataset.mnav;
  $$('#mobileNav [data-mnav]').forEach((x) => x.classList.toggle('on', x === b));
  if (k === 'home') { show('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  else if (k === 'cats') { show('home'); const el = document.getElementById('secCats').hidden ? document.getElementById('products') : document.getElementById('secCats'); el.scrollIntoView({ behavior: 'smooth' }); }
  else if (k === 'cart') { $('#cartDrawer').hidden = false; await renderCart(); }
  else if (k === 'dash') { if (ME) renderDash(); else openAuth('login'); }
  else if (k === 'fav') { FAV_ONLY = !FAV_ONLY; $('#favToggle').textContent = FAV_ONLY ? '❤️ مفضلتي (معروضة)' : '🤍 مفضلتي'; show('home'); loadProducts().catch(() => {}); window.scrollTo({ top: 0, behavior: 'smooth' }); toast(FAV_ONLY ? 'تعرض مفضلتك فقط ❤️' : 'تعرض كل المنتجات'); }
  else if (k === 'more') { $('#moreSheet').hidden = false; }
}));
$('#closeMore').addEventListener('click', () => { $('#moreSheet').hidden = true; });
$('#moreSheet').addEventListener('click', (e) => { if (e.target.id === 'moreSheet') $('#moreSheet').hidden = true; });
$$('#moreSheet a').forEach((a) => a.addEventListener('click', () => { $('#moreSheet').hidden = true; }));
$('#moreTrack').addEventListener('click', (e) => { e.preventDefault(); $('#moreSheet').hidden = true; openTrack(); });
$('#scanBtn').addEventListener('click', () => { $('#searchInput').focus(); });
$('#moreLang').addEventListener('click', (e) => { e.preventDefault(); $('#moreSheet').hidden = true; $('#langBtn').click(); });
$('#moreTheme').addEventListener('click', (e) => { e.preventDefault(); $('#moreSheet').hidden = true; $('#themeBtn').click(); });
$('#moreAccount').addEventListener('click', (e) => { e.preventDefault(); $('#moreSheet').hidden = true; $('#accountBtn').click(); });
$('#moreFav').addEventListener('click', (e) => { e.preventDefault(); $('#moreSheet').hidden = true; if (!FAV_ONLY) $('#favToggle').click(); show('home'); document.getElementById('products').scrollIntoView({ behavior: 'smooth' }); });
$('#closeCart').addEventListener('click', () => { $('#cartDrawer').hidden = true; });
$('#goCheckout').addEventListener('click', () => openCheckout());
$('#coBack').addEventListener('click', () => show('home'));
$('#lightbox').addEventListener('click', () => { $('#lightbox').hidden = true; });
async function fillCommunes(wilaya) {
  const dl = $('#communeList'); if (!dl) return;
  dl.innerHTML = '';
  if (!wilaya) return;
  try {
    const r = await api('/api/communes?wilaya=' + wilaya);
    dl.innerHTML = (r.communes || []).map((c) => `<option value="${esc(c.ar || c.fr)}">${esc(c.fr || '')}</option>`).join('');
  } catch {}
}
$('#coWilaya').addEventListener('change', () => { updateTotals(); fillCommunes($('#coWilaya').value); });
$('#coDelType').addEventListener('change', updateTotals);
$('#searchInput').addEventListener('input', () => loadProducts().catch(() => {}));
$('#catFilter').addEventListener('change', () => loadProducts().catch(() => {}));
$('#priceFilter').addEventListener('change', () => loadProducts().catch(() => {}));
$('#sortSel').addEventListener('change', () => loadProducts().catch(() => {}));
$('#allTop').addEventListener('click', () => { $('#sortSel').value = 'sold'; loadProducts().catch(() => {}); document.getElementById('products').scrollIntoView({ behavior: 'smooth' }); });
$('#allNew').addEventListener('click', () => { $('#sortSel').value = ''; loadProducts().catch(() => {}); document.getElementById('products').scrollIntoView({ behavior: 'smooth' }); });
$('#favToggle').addEventListener('click', () => {
  FAV_ONLY = !FAV_ONLY;
  $('#favToggle').textContent = FAV_ONLY ? '❤️ مفضلتي (معروضة)' : '🤍 مفضلتي';
  loadProducts().catch(() => {});
});
$('#resetFilters').addEventListener('click', () => { resetAllFilters().catch(() => {}); const sc = document.getElementById('secCats'); if (sc) sc.scrollIntoView({ behavior: 'smooth' }); });
// الثيم الافتراضي: أخضر داكن × ذهبي (لوحة SOUQAR) — والفاتح اختياري من الزر
if (localStorage.getItem('pd_theme') === 'light') document.documentElement.dataset.theme = 'light';
$('#themeBtn').textContent = document.documentElement.dataset.theme === 'light' ? '🌙' : '☀️';
$('#themeBtn').addEventListener('click', () => {
  const light = document.documentElement.dataset.theme !== 'light';
  if (light) document.documentElement.dataset.theme = 'light'; else document.documentElement.removeAttribute('data-theme');
  localStorage.setItem('pd_theme', light ? 'light' : 'dark');
  $('#themeBtn').textContent = light ? '🌙' : '☀️';
});
$('#menuBtn').addEventListener('click', () => { $('#moreSheet').hidden = false; });
// جرس الإشعارات داخل التطبيق
function bindBellChips() {
    $$('#bellChips .chip').forEach((ch) => ch.addEventListener('click', () => {
      $$('#bellChips .chip').forEach((x) => x.classList.toggle('on', x === ch));
      const f = ch.dataset.bfilter;
      $$('#bellPanel .bell-item').forEach((it) => { it.style.display = f === 'all' || it.dataset.btype === f ? '' : 'none'; });
    }));
  }
  $('#bellBtn').addEventListener('click', async () => {
  const panel = $('#bellPanel');
  if (!panel.hidden) { panel.hidden = true; return; }
  panel.innerHTML = '<div class="bell-box"><p class="muted">جارٍ التحميل…</p></div>';
  panel.hidden = false;
  try {
    const { notifications, unread } = await api('/api/my/notifications');
    panel.innerHTML = `<div class="bell-box"><h4>🔔 إشعاراتي</h4><div class="chip-row" id="bellChips"><button class="chip on" data-bfilter="all" type="button">الكل</button><button class="chip" data-bfilter="order" type="button">الطلبات</button><button class="chip" data-bfilter="money" type="button">العمولات</button><button class="chip" data-bfilter="other" type="button">أخرى</button></div>${notifications.length ? notifications.map((n) => `<div class="bell-item ${n.read ? '' : 'unread'}" data-btype="${String(n.type || '').startsWith('order') ? 'order' : /commission|settlement|invite|payout|payment/.test(String(n.type || '')) ? 'money' : 'other'}"><p>${n.read ? '' : '🔵 '}${esc(n.text)}</p><span class="muted small">${new Date(n.created_at).toLocaleString('ar-DZ')}</span></div>`).join('') : '<p class="muted">لا إشعارات بعد.</p>'}</div>`;
    bindBellChips();
    if (unread) { await api('/api/my/notifications/read', { method: 'POST', body: {} }).catch(() => {}); updateBellBadge(0); }
  } catch (e) { panel.innerHTML = '<div class="bell-box"><p class="muted">تعذر التحميل.</p></div>'; }
});
document.addEventListener('click', (e) => { if (!e.target.closest('#bellBtn') && !e.target.closest('#bellPanel')) $('#bellPanel').hidden = true; });

$('#checkoutForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const SRC = CO_ITEMS || CART;
  if (!SRC.length) return toast('السلة فارغة', true);
  const btn = $('#checkoutBtn'); btn.disabled = true; btn.textContent = 'جارٍ إنشاء الطلب…';
  try {
    if (!checkoutKey) { checkoutKey = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()); sessionStorage.setItem('pd_checkout_key', checkoutKey); }
    const r = await api('/api/orders', { method: 'POST', body: {
      customer: { name: $('#coName').value, phone: $('#coPhone').value, wilaya: Number($('#coWilaya').value), commune: $('#coCommune').value, address: $('#coAddress').value, deliveryType: $('#coDelType').value },
      items: SRC.map((i) => ({ productId: i.productId, qty: i.qty, size: i.size, color: i.color, sellPrice: ME && ME.role === 'marketer' ? sellOf(i) : undefined })),
      idempotencyKey: checkoutKey
    } });
    if (CO_ITEMS) CO_ITEMS = null; else CART = [];
    checkoutKey = null; sessionStorage.removeItem('pd_checkout_key'); saveCart();
    $('#cartDrawer').hidden = true;
    toast('تم إنشاء طلبك بنجاح: ' + r.orders.map((o) => o.ref + ' (' + fmt(o.total) + ')').join(' · '));
    $('#trackRef').value = r.orders[0].ref; $('#trackPhone').value = $('#coPhone').value;
    $('#ttRef').value = r.orders[0].ref; $('#ttPhone').value = $('#coPhone').value;
    openTrack();
    doTrack(r.orders[0].ref, $('#coPhone').value, $('#ttResult')).catch(() => {});
  } catch (err) { toast(err.message, true); }
  btn.disabled = false; btn.textContent = 'تأكيد الطلب — الدفع عند الاستلام';
});
$('#trackForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#ttRef').value = $('#trackRef').value.trim(); $('#ttPhone').value = $('#trackPhone').value.trim();
  openTrack();
  try { await doTrack($('#ttRef').value, $('#ttPhone').value, $('#ttResult')); }
  catch (err) { $('#ttResult').innerHTML = ''; toast(err.message, true); }
});
$('#ttForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await doTrack($('#ttRef').value.trim(), $('#ttPhone').value.trim(), $('#ttResult')); }
  catch (err) { $('#ttResult').innerHTML = ''; toast(err.message, true); }
});
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: { phone: $('#liPhone').value, password: $('#liPass').value } });
    CSRF = r.csrf; await refreshMe();
    if (ME && ME.status === 'pending') { toast('حسابك قيد مراجعة الإدارة — ستُفعَّل صلاحيات النشر واستقبال الطلبات بعد الاعتماد.'); show('home'); }
    else { toast('مرحباً ' + ME.name); renderDash(); }
  } catch (err) { toast(err.message, true); }
});
$('#registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/auth/register', { method: 'POST', body: {
      role: regRole, name: $('#rgName').value, phone: $('#rgPhone').value, email: $('#rgEmail').value || undefined,
      password: $('#rgPass').value, passwordConfirm: $('#rgPass2').value,
      wilaya: $('#rgWilaya').value ? Number($('#rgWilaya').value) : undefined,
      telegramChatId: $('#rgTelegramM').value || undefined,
      inviteCode: localStorage.getItem('pd_inv') || undefined,
      terms: $('#rgTerms').checked
    } });
    toast(r.message);
    e.target.reset(); openAuth('login');
  } catch (err) { toast(err.message, true); }
});
$('#fgChannel').addEventListener('change', () => {
  $('#fgId').placeholder = $('#fgChannel').value === 'email' ? 'البريد الإلكتروني المسجل' : 'رقم هاتف الحساب';
});
$('#forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ch = $('#fgChannel').value, id = $('#fgId').value;
  try { const r = await api('/api/auth/forgot', { method: 'POST', body: ch === 'email' ? { email: id } : { phone: id } }); toast(r.message); $('#rsId').value = id; }
  catch (err) { toast(err.message, true); }
});
$('#resetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#rsId').value.trim(), tok = $('#rsToken').value.trim();
  const isCode = /^\d{6}$/.test(tok);
  const idBody = id.includes('@') ? { email: id } : { phone: id };
  const body = { ...idBody, password: $('#rsPass').value, passwordConfirm: $('#rsPass2').value, ...(isCode ? { code: tok } : { token: tok }) };
  try { const r = await api('/api/auth/reset', { method: 'POST', body }); toast(r.message); openAuth('login'); }
  catch (err) { toast(err.message, true); }
});
$('#setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('/api/setup', { method: 'POST', body: { name: $('#suName').value, phone: $('#suPhone').value, password: $('#suPass').value } }); toast('أُنشئ حساب المدير — سجّل الدخول الآن'); $('#setupCard').hidden = true; openAuth('login'); }
  catch (err) { toast(err.message, true); }
});

// ---------- تشغيل ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
(async function init() {
  // شاشة الترحيب: أول زيارة فقط
  try {
    if (!localStorage.getItem('pd_seen')) {
      const sp = $('#splash');
      if (sp) {
        sp.hidden = false;
        const closeSplash = (login) => { localStorage.setItem('pd_seen', '1'); sp.hidden = true; if (login) openAuth('login'); };
        $('#spStart').addEventListener('click', () => closeSplash(!ME));
      }
    }
  } catch (e) { /* بيئة بلا تخزين محلي */ }
  const params = new URLSearchParams(location.search);
  if (params.get('inv')) localStorage.setItem('pd_inv', params.get('inv'));
  selectRole('buyer');
  renderCartBadge();
  await initLoads(params);
  const rb = $('#connRetry'); if (rb) rb.addEventListener('click', () => initLoads(params));
})();

// تحميلات البداية — كل خطوة مستقلة: فشل واحدة لا يمنع الباقي، وأي فشل يظهر في شريط الاتصال بدل واجهة فارغة صامتة
async function initLoads(params) {
  let failed = false;
  try { const { wilayas } = await tryApi('/api/wilayas'); WILAYAS = wilayas; } catch { failed = true; if (!WILAYAS.length) WILAYAS = WILAYAS_FALLBACK; }
  fillWilayaSelects();
  try {
    const { categories } = await tryApi('/api/categories'); CATEGORIES = categories;
    const cf = $('#catFilter'); const keep = cf.value;
    cf.querySelectorAll('option:not(:first-child)').forEach((o) => o.remove());
    for (const c of CATEGORIES) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; cf.appendChild(o); }
    if (keep) cf.value = keep;
  } catch { failed = true; }
  try { await refreshMe(); } catch { failed = true; }
  try { const st = await api('/api/setup/status'); if (st.needsSetup) { $('#setupCard').hidden = false; openAuth('login'); } } catch { failed = true; }
  try { const cfg = await api('/api/config'); if (cfg.version && cfg.version !== CLIENT_VERSION && sessionStorage.getItem('pd_vr') !== cfg.version) { sessionStorage.setItem('pd_vr', cfg.version); location.reload(); return; } } catch {}
  try { await loadProducts(); } catch {
    failed = true;
    $('#productGrid').innerHTML = '<div class="card" style="text-align:center"><p>⚠️ تعذّر تحميل المنتجات — الخادم لا يرد حالياً.</p><button class="btn" type="button" onclick="location.reload()">إعادة المحاولة</button></div>';
    $('#secCats').hidden = true; $('#secNew').hidden = true; $('#secTop').hidden = true;
  }
  setConnError(failed);
  if (params && params.get('product')) openProduct(Number(params.get('product'))).catch(() => {});
}
