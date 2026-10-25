'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => Number(n || 0).toLocaleString('fr-DZ') + ' دج';
let CSRF = null, ME = null, WILAYAS = [], CATEGORIES = [], PRODUCTS = [];
let CART = JSON.parse(localStorage.getItem('pd_cart') || '[]');
let checkoutKey = sessionStorage.getItem('pd_checkout_key') || null;

function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  setTimeout(() => { t.hidden = true; }, 4200);
}
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (CSRF && (opts.method || 'GET') !== 'GET') headers['x-csrf'] = CSRF;
  const res = await fetch(path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || ('خطأ ' + res.status)); e.data = data; e.status = res.status; throw e; }
  return data;
}
function show(view) {
  for (const v of ['home', 'page', 'auth', 'dash', 'track']) $('#view-' + v).hidden = v !== view;
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
    <li>الدفع: لا توجد طلبات سحب — الدفع الفعلي يتم خارج المنصة حسب طريقة الاستلام المسجلة في حساب المسوق (تحويل بريدي موب، تحويل البريد الجاري، Flexy، ظرف بريدي، أو الاستلام من مقر المنصة)، وعند حدوثه توثّقه الإدارة في المنصة بطريقته ومرجعه فتتحول العمولات إلى «مدفوعة».</li>
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
  <p>اختر منتجاً من الكتالوج، انسخ وصفه وصوره وانشر إعلانك بسعرك أنت. عندما يطلب زبون، ادخل طلبه من السلة وحدّد سعر بيعك: ربحك = سعر بيعك − السعر الأساسي (5% على الأقل). أو شارك رابط إحالتك ودع الزبون يطلب بنفسه بالسعر الأساسي — ربحك عندها 5% من السعر الأساسي.</p>
  <h3>متى تصبح عمولتي قابلة للسحب؟</h3>
  <p>تمر عمولتك بـ: قيد الانتظار (الطلب جديد) ← في التوصيل ← موافق عليها (بعد تسليم الطلب وتحصيل ثمنه نقداً) ← مدفوعة (بعد معالجة طلب الدفع). الطلبات الملغاة أو المرتجعة تُلغى عمولاتها.</p>
  <h3>كيفاش نسحب أرباحي؟</h3>
  <p>من محفظتك في لوحتك: اضبط طريقة الدفع وتفاصيلها في «إعدادات حسابي» (بريدي موب، CCP، Flexy، ظرف بريدي، أو الاستلام من المقر)، ثم اطلب الدفع — مرة واحدة في الأسبوع — ويُعالج طلبك خلال 24–48 ساعة.</p>
  <h3>واش هو برنامج ادعو أصدقائك؟</h3>
  <p>شارك رابط دعوتك من لوحتك: كل صديق ينضم كمسوق بدعوتك ويبلغ بأرباح موافق عليها 5000 دج، تربح أنت 500 دج مكافأة في رصيدك.</p>
  <h3>شكون يوصل الطلبات ويستلم الدراهم؟</h3>
  <p>المورد يجهز الطلب ويوصله عبر شركة توصيله، والزبون يدفع نقداً عند الاستلام. المنصة تنظم العرض والطلبات والأرباح فقط.</p>
  <h3>هل التوصيل للمنزل ولا للمكتب؟</h3>
  <p>الزبون يختار عند الطلب: توصيل للمنزل أو لمكتب شركة التوصيل — الأسعار لكل ولاية في صفحة «أسعار التوصيل».</p>`,
  training: `<h2>🎓 تدريب المسوقين — ابدأ في 6 خطوات</h2>
  <ol>
    <li><strong>اختر منتجاً رابحاً:</strong> ابدأ بمنتجات «الأكثر طلباً» في الصفحة الرئيسية — الطلب عليها مثبت.</li>
    <li><strong>جهّز موادك:</strong> من صفحة المنتج: ⬇️ حمّل الصور و📋 انسخ الوصف الجاهز مع رابطك.</li>
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
      <div class="pcard-media">
        ${p.images && p.images.length ? `<img src="${esc(p.images[0])}" alt="${esc(p.name)}" loading="lazy">` : '<div class="noimg">📦</div>'}
        ${disc ? `<span class="disc-badge">-${disc}%</span>` : ''}
        <button class="fav-btn" data-fav="${p.id}" type="button" aria-label="المفضلة">${FAVS.has(p.id) ? '❤️' : '🤍'}</button>
        ${p.sold >= 3 ? `<span class="sold-badge">🔥 الأكثر مبيعاً</span>` : ''}
      </div>
      <div class="pcard-body">
        <h3>${esc(p.name)}</h3>
        ${p.rating_count ? starsHtml(p.rating_avg, p.rating_count) : `<span class="muted small">${esc(p.category_name || '')}</span>`}
        <div class="pcard-foot">
          ${priceHtml(p)}
          <button class="add-btn" data-add="${p.id}" type="button" ${p.stock <= 0 ? 'disabled' : ''} aria-label="أضف إلى السلة">🛒</button>
        </div>
        ${p.stock > 0 ? (p.stock <= 3 ? '<span class="badge out">بقي ' + p.stock + ' فقط</span>' : '<span class="stock-ok">● متوفر</span>') : '<span class="badge out">نفد المخزون</span>'}
        <button class="btn light small" data-view="${p.id}" type="button" style="width:100%;margin-top:8px">عرض التفاصيل</button>
      </div>
    </article>`;
}
function wireCards(root) {
  $$('#' + root + ' [data-view]').forEach((b) => b.addEventListener('click', () => openProduct(Number(b.dataset.view))));
  $$('#' + root + ' [data-add]').forEach((b) => b.addEventListener('click', () => { addToCart(Number(b.dataset.add), 1); }));
  $$('#' + root + ' [data-fav]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.fav);
    if (FAVS.has(id)) { FAVS.delete(id); toast('أُزيل من المفضلة'); } else { FAVS.add(id); toast('أُضيف إلى المفضلة ❤️'); }
    saveFavs(); loadProducts().catch(() => {});
  }));
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
  const newest = [...PRODUCTS].sort((a, b) => b.id - a.id).slice(0, 4);
  const top = [...PRODUCTS].filter((p) => p.sold > 0).sort((a, b) => b.sold - a.sold).slice(0, 4);
  $('#secNew').hidden = !(plain && newest.length);
  $('#secTop').hidden = !(plain && top.length);
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
    const tiles = CATEGORIES.map((c) => ({ c, n: PRODUCTS.filter((p) => p.category_id === c.id).length })).filter((x) => x.n);
    $('#secCats').hidden = !tiles.length;
    $('#catTiles').innerHTML = tiles.map(({ c, n }) => { const fp = PRODUCTS.find((x) => x.category_id === c.id && x.images && x.images.length); return `<button class="cat-circle" data-tile="${c.id}" type="button">${fp ? `<img class="cc-img" src="${esc(fp.images[0])}" alt="" loading="lazy">` : `<span class="cc-img cc-emoji">${iconFor(c.name)}</span>`}<b>${esc(c.name)}</b><span>${n} منتج</span></button>`; }).join('');
    const pi = $('#promoImg'); const fpp = PRODUCTS.find((x) => x.images && x.images.length); if (pi && fpp) { pi.src = fpp.images[0]; pi.hidden = false; }
    $$('#catTiles [data-tile]').forEach((t) => t.addEventListener('click', () => { $('#catFilter').value = t.dataset.tile; loadProducts().catch(() => {}); document.getElementById('products').scrollIntoView({ behavior: 'smooth' }); }));
  } else { $('#catChips').innerHTML = ''; $('#secCats').hidden = true; }
}
async function openProduct(id) {
  const { product: p } = await api('/api/products/' + id);
  const box = $('#productModalBox');
  const pageUrl = location.origin + '/?product=' + p.id + (currentRef() ? '&ref=' + currentRef() : '');
  box.innerHTML = `
    <div class="drawer-head"><h3>${esc(p.name)}</h3><button class="icon-btn dark" id="pmClose" type="button">✕</button></div>
    ${p.images.length ? `<img class="main-img" id="pmMain" src="${esc(p.images[0])}" alt="${esc(p.name)}">
    <div class="gallery">${p.images.map((im, i) => `<img src="${esc(im)}" data-g="${i}" class="${i === 0 ? 'sel' : ''}" alt="">`).join('')}</div>` : '<div class="noimg" style="height:200px;display:flex;align-items:center;justify-content:center;font-size:60px;background:#eef2f5;border-radius:13px">📦</div>'}
    <p>${esc(p.description || '')}</p>
    <p>${priceHtml(p)} ${p.stock > 0 ? '<span class="badge">متوفر — مخزون ' + p.stock + '</span>' : '<span class="badge out">نفد المخزون</span>'}</p>
    <p class="muted small">🏪 المتجر: <a href="#" id="pmStore"><strong>${esc(p.business_name || p.supplier_name || 'متجر المورد')}</strong></a> — اضغط لعرض كل منتجات هذا المتجر</p>
    ${p.sizes.length ? `<div>المقاس<div class="swatches" id="pmSizes">${p.sizes.map((s, i) => `<button type="button" data-size="${esc(s)}" class="${i === 0 ? 'sel' : ''}">${esc(s)}</button>`).join('')}</div></div>` : ''}
    ${p.colors.length ? `<div>اللون<div class="swatches" id="pmColors">${p.colors.map((s, i) => `<button type="button" data-color="${esc(s)}" class="${i === 0 ? 'sel' : ''}">${esc(s)}</button>`).join('')}</div></div>` : ''}
    <label>الكمية <input type="number" id="pmQty" value="1" min="1" max="99"></label>
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
    <div class="buy-row">
      <button class="btn gold big" id="pmAdd" ${p.stock <= 0 ? 'disabled' : ''}>🛒 أضف إلى السلة</button>
      <button class="btn big" id="pmBuyNow" ${p.stock <= 0 ? 'disabled' : ''}>⚡ اشترِ الآن</button>
    </div>`;
  $('#productModal').hidden = false;
  $('#pmClose').addEventListener('click', () => { $('#productModal').hidden = true; });
  $$('#productModalBox [data-g]').forEach((im) => im.addEventListener('click', () => {
    $('#pmMain').src = im.src; $$('#productModalBox [data-g]').forEach((x) => x.classList.remove('sel')); im.classList.add('sel');
  }));
  let selSize = p.sizes[0] || null, selColor = p.colors[0] || null;
  $$('#pmSizes [data-size]').forEach((b) => b.addEventListener('click', () => { selSize = b.dataset.size; $$('#pmSizes [data-size]').forEach((x) => x.classList.toggle('sel', x === b)); }));
  $$('#pmColors [data-color]').forEach((b) => b.addEventListener('click', () => { selColor = b.dataset.color; $$('#pmColors [data-color]').forEach((x) => x.classList.toggle('sel', x === b)); }));
  $('#pmStore').addEventListener('click', (e) => { e.preventDefault(); $('#productModal').hidden = true; openStore(p.supplier_id); });
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
    $('#productModal').hidden = true;
  });
  $('#pmBuyNow').addEventListener('click', async () => {
    addToCart(p.id, Number($('#pmQty').value) || 1, selSize, selColor);
    $('#productModal').hidden = true;
    $('#cartDrawer').hidden = false; await renderCart();
  });
  $('#pmCopyDesc').addEventListener('click', async () => {
    await navigator.clipboard.writeText(`${p.name}\n${p.description || ''}\n💰 السعر: ${fmt(p.customer_price)} — الدفع عند الاستلام\n${pageUrl}`).catch(() => {});
    toast('نُسخ وصف المنتج — الصقه في إعلانك');
  });
  const dlb = $('#pmDlImgs');
  if (dlb) dlb.addEventListener('click', () => {
    p.images.forEach((im, i) => setTimeout(() => { const a = document.createElement('a'); a.href = im; a.target = '_blank'; a.rel = 'noopener'; a.click(); }, i * 350));
    toast('تُفتح صور المنتج — احفظها لاستعمالها في إعلاناتك');
  });
  $('#pmFav').addEventListener('click', () => {
    if (FAVS.has(p.id)) FAVS.delete(p.id); else FAVS.add(p.id);
    saveFavs(); $('#pmFav').textContent = FAVS.has(p.id) ? '❤️ في المفضلة' : '🤍 أضف للمفضلة'; loadProducts().catch(() => {});
  });
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
async function updateTotals() {
  $('#coTotals').hidden = false;
  const w = Number($('#coWilaya').value);
  const isMk = ME && ME.role === 'marketer';
  const subtotal = CART.reduce((a, i) => a + sellOf(i) * i.qty, 0);
  let html = `<div>مجموع المنتجات: <strong>${fmt(subtotal)}</strong></div>`;
  if (isMk) html += `<div>💰 عمولتك المتوقعة من هذا الطلب: <strong>${fmt(CART.reduce((a, i) => a + (sellOf(i) - i.price) * i.qty, 0))}</strong></div>`;
  if (w) {
    try {
      const fees = {};
      const office = $('#coDelType') && $('#coDelType').value === 'office';
      for (const i of CART) {
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
  $('#modalBox').innerHTML = receiptHtml + `
    <div class="actions-row">
      <button class="btn" id="rcShare" type="button">📤 مشاركة الوصل</button>
      <button class="btn light" id="rcCopy" type="button">📋 نسخ النص</button>
      <button class="btn light" id="rcPrint" type="button">🖨 طباعة</button>
    </div>`;
  $('#modal').hidden = false;
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
  $('#supplierFields').hidden = r !== 'supplier';
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
  return ME;
}

// ---------- لوحات التحكم ----------
const STATUS_FLOW = ['pending_supplier', 'confirmed', 'preparing', 'handed', 'out_for_delivery', 'delivered_collected', 'failed_delivery', 'returned', 'cancelled', 'rejected'];
const STATUS_AR = { pending_supplier: 'جديد — بانتظار تأكيد المورد', confirmed: 'مؤكد', preparing: 'قيد التجهيز', handed: 'سُلّم لشركة التوصيل', out_for_delivery: 'خرج للتوصيل', delivered_collected: 'تم التسليم والتحصيل', cancelled: 'أُلغي', rejected: 'مرفوض', failed_delivery: 'تعذر التسليم', returned: 'مرتجع' };

function renderSettings() {
  const box = $('#dashSettings');
  if (!ME) { box.innerHTML = ''; return; }
  box.innerHTML = `
  <details class="card"><summary><strong>⚙️ إعدادات حسابي</strong> — الاسم: ${esc(ME.name)} · الهاتف: ${esc(ME.phone)}${ME.email ? ' · البريد: ' + esc(ME.email) : ''}</summary>
    <form id="profileForm" class="stack" style="margin-top:12px">
      <input id="pfName" value="${esc(ME.name)}" placeholder="الاسم الكامل">
      <input id="pfEmail" type="email" value="${esc(ME.email || '')}" placeholder="البريد الإلكتروني">
      <select id="pfWilaya"><option value="">— الولاية —</option>${WILAYAS.map((w) => `<option value="${w.code}" ${ME.wilaya === w.code ? 'selected' : ''}>${w.code} — ${esc(w.name_ar)}</option>`).join('')}</select>
      <input id="pfCommune" list="communeList" value="${esc(ME.commune || '')}" placeholder="البلدية — اختر أو اكتب">
      <input id="pfAddress" value="${esc(ME.address || '')}" placeholder="العنوان">
      ${ME.role === 'supplier' ? `<input id="pfBusiness" value="${esc(ME.business_name || '')}" placeholder="اسم النشاط/المتجر">` : ''}
      <input id="pfTelegram" value="${esc(ME.telegram_chat_id || '')}" placeholder="معرّف تيليغرام الرقمي (لإشعارات فورية — اختياري)">
      ${ME.role === 'marketer' ? `<select id="pfPayMethod">
        <option value="">— طريقة استلام أرباحك —</option>
        ${['تحويل بريدي موب', 'تحويل البريد الجاري', 'التحصيل من مقر المنصة', 'Enveloppe', 'Flexy', 'نقداً عند الاستلام من الإدارة'].map((m) => `<option ${ME.payment_method === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
      <input id="pfPayDetails" value="${esc(ME.payment_details || '')}" placeholder="تفاصيل الدفع (رقم الحساب/الهاتف المرتبط…)">` : ''}
      <button class="btn" type="submit">حفظ البيانات</button>
      <p class="muted small">رقم الهاتف هو معرّف الدخول ولا يتغير من هنا. تغيير البريد يتطلب تأكيده برمز جديد.</p>
    </form>
    <form id="pwForm" class="stack">
      <h4>تغيير كلمة المرور</h4>
      <input id="pwCur" type="password" placeholder="كلمة المرور الحالية" autocomplete="current-password">
      <input id="pwNew" type="password" placeholder="كلمة المرور الجديدة (8 أحرف على الأقل)" autocomplete="new-password">
      <input id="pwNew2" type="password" placeholder="تأكيد كلمة المرور الجديدة" autocomplete="new-password">
      <button class="btn gold" type="submit">تغيير كلمة المرور</button>
    </form>
  </details>`;
  const pmSel = $('#pfPayMethod');
  if (pmSel) {
    const pmLabels = { 'تحويل بريدي موب': 'RIB البريد موب', 'تحويل البريد الجاري': 'رقمك ومفتاحك البريدي', 'التحصيل من مقر المنصة': 'الاسم الكامل ورقم هاتفك — الاستلام من مقر المنصة', 'Enveloppe': 'الاسم الكامل، العنوان، الهاتف', 'Flexy': 'رقم هاتفك Flexy', 'نقداً عند الاستلام من الإدارة': 'الاسم الكامل ورقم هاتفك' };
    const pmUpd = () => { const d = $('#pfPayDetails'); if (d) d.placeholder = pmLabels[pmSel.value] || 'تفاصيل الدفع'; };
    pmSel.addEventListener('change', pmUpd); pmUpd();
  }
  const pfW = $('#pfWilaya');
  if (pfW) { pfW.addEventListener('change', () => fillCommunes(pfW.value)); if (pfW.value) fillCommunes(pfW.value); }
  $('#profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/me', { method: 'PATCH', body: { name: $('#pfName').value, email: $('#pfEmail').value, wilaya: $('#pfWilaya').value, commune: $('#pfCommune').value, address: $('#pfAddress').value, businessName: $('#pfBusiness') ? $('#pfBusiness').value : undefined, telegramChatId: $('#pfTelegram').value, paymentMethod: $('#pfPayMethod') ? $('#pfPayMethod').value : undefined, paymentDetails: $('#pfPayDetails') ? $('#pfPayDetails').value : undefined } });
      toast(r.message); await refreshMe(); renderDash();
    } catch (err) { toast(err.message, true); }
  });
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/me/password', { method: 'POST', body: { currentPassword: $('#pwCur').value, password: $('#pwNew').value, passwordConfirm: $('#pwNew2').value } });
      toast(r.message); e.target.reset();
    } catch (err) { toast(err.message, true); }
  });
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
        <a class="menu-row" href="#" data-nav="support">💬 المساعدة والدعم <span>‹</span></a>
        <a class="menu-row" href="#" data-nav="faq">❓ الأسئلة الشائعة <span>‹</span></a>
        <button class="menu-row" id="hubLogout" type="button">🚪 تسجيل الخروج <span>‹</span></button>
      </div>
    </div>
    <div class="card" id="buyerOrders"><h3>طلباتي</h3>${orders.length ? `<div class="tablewrap"><table>
    <tr><th>الرقم</th><th>الحالة</th><th>الإجمالي</th><th>التاريخ</th><th></th></tr>
    ${orders.map((o) => `<tr><td>${esc(o.ref)}</td><td>${esc(o.status_label)}</td><td>${fmt(o.total)}</td><td>${new Date(o.created_at).toLocaleDateString('ar-DZ')}</td>
    <td><button class="btn small light" data-details="${o.id}">📋 التفاصيل</button> <button class="btn small" data-reorder="${o.id}">🔁 اطلب مجدداً</button> ${o.status === 'pending_supplier' ? `<button class="btn small danger" data-cancel="${o.id}">إلغاء</button>` : ''}</td></tr>`).join('')}</table></div>` : '<p class="muted">لا توجد طلبات بعد.</p>'}</div>`;
  const hub = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
  hub('#hubOrders', () => $('#buyerOrders').scrollIntoView({ behavior: 'smooth' }));
  hub('#hubSettings', () => $('#dashSettings').scrollIntoView({ behavior: 'smooth' }));
  hub('#hubBell', () => $('#bellBtn').click());
  hub('#hubLogout', () => $('#logoutBtn').click());
  $$('#dashContent [data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/my/orders/${b.dataset.cancel}/cancel`, { method: 'POST', body: {} }); toast('أُلغي الطلب'); renderDash(); }
    catch (e) { toast(e.message, true); }
  }));
}
const COMM_STATE_AR = (c, orderStatus) => c.state === 'paid' ? 'مدفوعة ✅' : c.state === 'payable' ? 'موافق عليها 💰' : c.state === 'cancelled' ? 'ملغاة' : (['handed', 'out_for_delivery'].includes(orderStatus) ? 'في التوصيل 🚚' : 'قيد الانتظار ⏳');
async function renderMarketer(box) {
  const [{ products }, { commissions, settlements }, { orders }, { wallet }, invite] = await Promise.all([
    api('/api/marketer/products'), api('/api/marketer/commissions'), api('/api/marketer/orders'), api('/api/my/wallet'), api('/api/my/invite')
  ]);
  const commByRef = Object.fromEntries(commissions.map((c) => [c.ref, c]));
  const orderStatusByRef = Object.fromEntries(orders.map((o) => [o.ref, o.status]));
  const invLink = location.origin + '/?inv=' + invite.code;
  box.innerHTML = `
  <div class="grid" style="margin-bottom:14px">
    <div class="card stat-card"><span class="stat-ic">🧾</span><strong>${orders.length}</strong><span>كل الطلبات</span><small>إجمالي طلبيات زبائنك</small></div>
    <div class="card stat-card"><span class="stat-ic">🚚</span><strong>${orders.filter((o) => ['pending_supplier', 'confirmed', 'preparing', 'handed', 'out_for_delivery'].includes(o.status)).length}</strong><span>قيد التوصيل</span><small>الطلبات التي لم تُسلّم بعد</small></div>
    <div class="card stat-card"><span class="stat-ic">✅</span><strong>${orders.filter((o) => o.status === 'delivered_collected').length}</strong><span>تم التسليم</span><small>الطلبات المستلمة بنجاح</small></div>
    <div class="card stat-card"><span class="stat-ic">💰</span><strong>${fmt(wallet.approved + wallet.paid)}</strong><span>العمولات</span><small>المستحقة والمدفوعة</small></div>
  </div>
  <div class="card"><h3>📍 مراحل تتبّع كل طلب</h3><div class="stages-strip">${['طلب جديد', 'تم تأكيد الطلب', 'قيد التجهيز لدى المورد', 'تم تسليمه لشركة التوصيل', 'خرج للتوصيل', 'تم التسليم أو الإرجاع أو الإلغاء'].map((t, i) => `<div class="stage-pill"><b>${i + 1}</b><span>${t}</span></div>`).join('')}</div></div>
  <div class="card" id="sec-wallet"><h3>💰 محفظتي</h3>
    <div class="stat-grid">
      <div class="stat">إجمالي أرباحي<b>${fmt(wallet.approved + wallet.paid + wallet.waiting + wallet.inDelivery)}</b></div>
      <div class="stat">طلبات جلبتها<b>${orders.length}</b></div>
      <div class="stat">مكافآت الدعوات 🎁<b>${fmt(wallet.bonuses)}</b></div>
    </div>
    <div class="wallet-hero">
      <span class="small" style="opacity:.85">💳 محفظتي — الرصيد القابل للدفع</span>
      <div class="wh-amount">${fmt(wallet.balance)}</div>
      <span class="small" style="opacity:.9">وسيلة استلامي: ${ME.payment_method ? esc(ME.payment_method) + (ME.payment_details ? ' — ' + esc(ME.payment_details) : '') : 'لم تُضبط بعد — اضبطها من «إعدادات حسابي» أسفله (CCP / بريدي موب / Flexy)'}</span>
    </div>
    <div class="tiles">
      <div class="tile blue"><small>عمولة في توصيل</small><b>${fmt(wallet.inDelivery)}</b></div>
      <div class="tile green"><small>عمولة قيد الانتظار</small><b>${fmt(wallet.waiting)}</b></div>
      <div class="tile teal"><small>عمولة موافق عليها</small><b>${fmt(wallet.approved)}</b></div>
      <div class="tile purple"><small>عمولة مدفوعة</small><b>${fmt(wallet.paid)}</b></div>
    </div>
    <p class="muted small">الدفع الفعلي يتم خارج المنصة (CCP / بريدي موب / Flexy…) حسب وسيلتك المسجّلة — لا توجد طلبات دفع؛ عند حدوث الدفع توثّقه الإدارة هنا بطريقته ومرجعه فتتحول عمولاتك إلى «مدفوعة».</p>
    ${(() => { const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i)); const sum = commissions.filter((c) => c.state !== 'cancelled' && new Date(c.created_at) >= d && new Date(c.created_at) < new Date(d.getTime() + 86400e3)).reduce((a, c) => a + c.amount, 0); return { d, sum }; }); const max = Math.max(1, ...days.map((x) => x.sum)); return `<h4>📈 أداء المبيعات — آخر 7 أيام</h4><div style="display:flex;gap:6px;align-items:flex-end;height:90px">${days.map((x) => `<div style="flex:1;text-align:center"><div title="${fmt(x.sum)}" style="background:var(--gold);border-radius:6px 6px 0 0;height:${Math.max(4, Math.round(x.sum / max * 56))}px"></div><span class="muted small">${x.d.toLocaleDateString('ar-DZ', { weekday: 'short' })}</span><br><span class="small">${x.sum ? fmt(x.sum) : '—'}</span></div>`).join('')}</div>`; })()}
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
    <p class="muted small">عمولتك <strong>حسب اختيارك</strong>: السعر المعروض هو السعر الأساسي، حدّد سعر بيعك عند إدخال طلب الزبون في السلة وربحك هو الفرق (5% على الأقل).</p>
    <div class="tablewrap"><table>
    <tr><th>المنتج</th><th>السعر الأساسي</th><th>المخزون</th><th>مواد التسويق اليدوي</th></tr>
    ${products.map((p) => `<tr><td>${esc(p.name)}</td><td>${fmt(p.customer_price)}</td>
      <td>${p.stock > 0 ? p.stock : '<span class="badge out">نافد</span>'}</td>
      <td><button class="btn small light" data-copydesc="${p.id}">📋 نسخ الوصف</button> <button class="btn small light" data-dlimgs="${p.id}">⬇️ الصور</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">لا منتجات معتمدة بعد</td></tr>'}</table></div>
  </div>
  <div class="card" id="sec-orders"><h3>طلباتي وحالات أرباحها</h3>${orders.length ? `<div class="chip-row" id="mkOrderChips"><button class="chip on" data-ofilter="all" type="button">الكل</button><button class="chip" data-ofilter="progress" type="button">قيد التوصيل</button><button class="chip" data-ofilter="delivered" type="button">تم التسليم</button><button class="chip" data-ofilter="bad" type="button">ملغاة / مرتجعة</button></div><div class="tablewrap"><table><tr><th>الرقم</th><th>حالة الطلب</th><th>الإجمالي</th><th>عمولتي</th><th>حالة العمولة</th><th></th></tr>${orders.map((o) => { const c = commByRef[o.ref]; return `<tr data-ostatus="${o.status}"><td>${esc(o.ref)}</td><td>${esc(o.status_label)}</td><td>${fmt(o.total)}</td><td>${c ? fmt(c.amount) : '—'}</td><td>${c ? COMM_STATE_AR(c, o.status) : '—'}</td><td><button class="btn small light" data-details="${o.id}">📋 التفاصيل</button></td></tr>`; }).join('')}</table></div>` : '<p class="muted">لا طلبات بعد.</p>'}</div>
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
  $$('#dashContent [data-copydesc]').forEach((b) => b.addEventListener('click', async () => {
    const p = products.find((x) => x.id === Number(b.dataset.copydesc));
    const txt = `${p.name}\n${p.description || ''}\n💰 السعر: ${fmt(p.customer_price)} — الدفع عند الاستلام`;
    await navigator.clipboard.writeText(txt).catch(() => {});
    toast('نُسخ الوصف التسويقي — سوّق يدوياً والصق أين تشاء');
  }));
  $$('#dashContent [data-dlimgs]').forEach((b) => b.addEventListener('click', () => {
    const p = products.find((x) => x.id === Number(b.dataset.dlimgs));
    if (!p.images || !p.images.length) return toast('لا صور لهذا المنتج', true);
    p.images.forEach((im, i) => setTimeout(() => { const a = document.createElement('a'); a.href = im; a.target = '_blank'; a.rel = 'noopener'; a.click(); }, i * 350));
    toast('تُفتح ' + p.images.length + ' صورة — احفظ ما تحتاجه لإعلانك');
  }));
  const mkp = $('#mkProfile');
  if (mkp) mkp.addEventListener('click', () => { const det = document.querySelector('#dashSettings details'); if (det) det.open = true; });
  const ml = $('#mkLogout');
  if (ml) ml.addEventListener('click', () => { const lb = $('#logoutBtn'); if (lb) lb.click(); });
  const ci = $('#copyInv');
  if (ci) ci.addEventListener('click', async () => { await navigator.clipboard.writeText(invLink).catch(() => {}); toast('نُسخ رابط الدعوة'); });
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
    </div>`).join('') : '<p class="muted">لا منتجات بعد.</p>'}</div>
  <div class="card" id="supOrdersSec"><h3>طلباتي الواردة</h3>
    ${orders.length ? `<div class="chip-row" id="supOrderChips"><button class="chip on" data-ofilter="all" type="button">الكل</button><button class="chip" data-ofilter="new" type="button">جديدة</button><button class="chip" data-ofilter="progress" type="button">قيد المعالجة</button><button class="chip" data-ofilter="delivered" type="button">تم التسليم</button><button class="chip" data-ofilter="bad" type="button">ملغاة / مرتجعة</button></div>` + orders.map((o) => `
    <div class="ord-card" data-ostatus="${o.status}">
      <div class="ord-head"><strong>${esc(o.ref)}</strong><span class="badge">${esc(o.status_label)}</span><strong style="color:#0d9d63">${fmt(o.total)}</strong></div>
      <p class="small" style="margin:7px 0">👤 ${esc(o.guest_name || '')} (${esc(o.guest_phone || '')}) · 📍 ${wilayaName(o.wilaya)} / ${esc(o.commune)} — ${esc(o.address)}</p>
      <p class="small muted" style="margin:4px 0">${o.items.map((i) => `${esc(i.name)} × ${i.qty} — ${fmt(i.customer_price * i.qty)}`).join('<br>')}</p>
      <p class="muted small">التوصيل: ${fmt(o.delivery_fee)}${o.reject_reason ? ' · سبب الرفض: ' + esc(o.reject_reason) : ''}</p>
      <p><button class="btn small light" data-details="${o.id}">📋 التفاصيل الكاملة والخط الزمني</button></p>
      <div class="row-form">
        <select id="st-${o.id}">${STATUS_FLOW.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${STATUS_AR[s]}</option>`).join('')}</select>
        <input id="rs-${o.id}" placeholder="سبب (إلزامي عند الرفض/الإلغاء)">
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
  $('#prodForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const urls = $('#pfImgUrls').value.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      const r = await api('/api/supplier/products', { method: 'POST', body: {
        name: $('#pfName').value, description: $('#pfDesc').value,
        wholesalePrice: Number($('#pfWholesale').value), stock: Number($('#pfStock').value),
        comparePrice: $('#pfCompare').value ? Number($('#pfCompare').value) : undefined,
        categoryId: $('#pfCat').value ? Number($('#pfCat').value) : null,
        sizes: $('#pfSizes').value.split(',').map((s) => s.trim()).filter(Boolean),
        colors: $('#pfColors').value.split(',').map((s) => s.trim()).filter(Boolean),
        images: [...uploaded, ...urls].slice(0, 6)
      } });
      toast(r.message); renderDash();
    } catch (err) { toast(err.message, true); }
  });
  $$('#dashContent [data-status]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.status;
    try { await api(`/api/supplier/orders/${id}/status`, { method: 'POST', body: { status: $('#st-' + id).value, reason: $('#rs-' + id).value } }); toast('حُدّثت حالة الطلب'); renderDash(); }
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
$('#authBtn').addEventListener('click', () => openAuth('login'));
$('#joinMarketer').addEventListener('click', () => openAuth('register', 'marketer'));
$('#joinSupplier').addEventListener('click', () => openAuth('register', 'supplier'));
$('#dashBtn').addEventListener('click', renderDash);
$('#logoutBtn').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {}); ME = null; CSRF = null; await refreshMe(); show('home'); toast('تم تسجيل الخروج'); });
$$('[data-authtab]').forEach((t) => t.addEventListener('click', () => openAuth(t.dataset.authtab)));
$$('.role-tabs .tab').forEach((t) => t.addEventListener('click', () => selectRole(t.dataset.role)));
$('#cartBtn').addEventListener('click', async () => { $('#cartDrawer').hidden = false; await renderCart(); });
// شريط التنقل السفلي (الجوال) كيما نموذج التطبيق
$$('#mobileNav [data-mnav]').forEach((b) => b.addEventListener('click', async () => {
  const k = b.dataset.mnav;
  $$('#mobileNav [data-mnav]').forEach((x) => x.classList.toggle('on', x === b));
  if (k === 'home') { show('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  else if (k === 'cats') { show('home'); const el = document.getElementById('secCats').hidden ? document.getElementById('products') : document.getElementById('secCats'); el.scrollIntoView({ behavior: 'smooth' }); }
  else if (k === 'cart') { $('#cartDrawer').hidden = false; await renderCart(); }
  else if (k === 'dash') { if (ME) renderDash(); else openAuth('login'); }
  else if (k === 'more') { $('#moreSheet').hidden = false; }
}));
$('#closeMore').addEventListener('click', () => { $('#moreSheet').hidden = true; });
$('#moreSheet').addEventListener('click', (e) => { if (e.target.id === 'moreSheet') $('#moreSheet').hidden = true; });
$$('#moreSheet a').forEach((a) => a.addEventListener('click', () => { $('#moreSheet').hidden = true; }));
$('#moreTrack').addEventListener('click', (e) => { e.preventDefault(); $('#moreSheet').hidden = true; openTrack(); });
$('#closeCart').addEventListener('click', () => { $('#cartDrawer').hidden = true; });
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
$('#favToggle').addEventListener('click', () => {
  FAV_ONLY = !FAV_ONLY;
  $('#favToggle').textContent = FAV_ONLY ? '❤️ مفضلتي (معروضة)' : '🤍 مفضلتي';
  loadProducts().catch(() => {});
});
// الوضع المظلم
if (localStorage.getItem('pd_theme') === 'dark') document.documentElement.dataset.theme = 'dark';
$('#themeBtn').textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙';
$('#themeBtn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : '';
  localStorage.setItem('pd_theme', dark ? 'dark' : 'light');
  $('#themeBtn').textContent = dark ? '☀️' : '🌙';
});
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
    const { notifications } = await api('/api/my/notifications');
    panel.innerHTML = `<div class="bell-box"><h4>🔔 إشعاراتي</h4><div class="chip-row" id="bellChips"><button class="chip on" data-bfilter="all" type="button">الكل</button><button class="chip" data-bfilter="order" type="button">الطلبات</button><button class="chip" data-bfilter="money" type="button">العمولات</button><button class="chip" data-bfilter="other" type="button">أخرى</button></div>${notifications.length ? notifications.map((n) => `<div class="bell-item" data-btype="${String(n.type || '').startsWith('order') ? 'order' : /commission|settlement|invite/.test(String(n.type || '')) ? 'money' : 'other'}"><p>${esc(n.text)}</p><span class="muted small">${new Date(n.created_at).toLocaleString('ar-DZ')} · ${esc(n.channel)} · ${esc(n.status)}</span></div>`).join('') : '<p class="muted">لا إشعارات بعد.</p>'}</div>`;
    bindBellChips();
  } catch (e) { panel.innerHTML = '<div class="bell-box"><p class="muted">تعذر التحميل.</p></div>'; }
});
document.addEventListener('click', (e) => { if (!e.target.closest('#bellBtn') && !e.target.closest('#bellPanel')) $('#bellPanel').hidden = true; });

$('#checkoutForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!CART.length) return toast('السلة فارغة', true);
  const btn = $('#checkoutBtn'); btn.disabled = true; btn.textContent = 'جارٍ إنشاء الطلب…';
  try {
    if (!checkoutKey) { checkoutKey = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()); sessionStorage.setItem('pd_checkout_key', checkoutKey); }
    const r = await api('/api/orders', { method: 'POST', body: {
      customer: { name: $('#coName').value, phone: $('#coPhone').value, wilaya: Number($('#coWilaya').value), commune: $('#coCommune').value, address: $('#coAddress').value, deliveryType: $('#coDelType').value },
      items: CART.map((i) => ({ productId: i.productId, qty: i.qty, size: i.size, color: i.color, sellPrice: ME && ME.role === 'marketer' ? sellOf(i) : undefined })),
      idempotencyKey: checkoutKey
    } });
    CART = []; checkoutKey = null; sessionStorage.removeItem('pd_checkout_key'); saveCart();
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
      businessName: $('#rgBusiness').value || undefined, activity: $('#rgActivity').value || undefined,
      address: $('#rgAddress').value || undefined,
      telegramChatId: (regRole === 'supplier' ? $('#rgTelegram').value : $('#rgTelegramM').value) || undefined,
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
  const { wilayas } = await api('/api/wilayas'); WILAYAS = wilayas;
  for (const sel of ['#coWilaya', '#rgWilaya']) {
    const el = $(sel); const first = el.querySelector('option'); el.innerHTML = ''; if (first) el.appendChild(first);
    for (const w of WILAYAS) { const o = document.createElement('option'); o.value = w.code; o.textContent = w.code + ' — ' + w.name_ar; el.appendChild(o); }
  }
  const { categories } = await api('/api/categories'); CATEGORIES = categories;
  for (const c of CATEGORIES) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; $('#catFilter').appendChild(o); }
  await refreshMe();
  const st = await api('/api/setup/status');
  if (st.needsSetup) { $('#setupCard').hidden = false; openAuth('login'); }
  selectRole('buyer');
  renderCartBadge();
  await loadProducts();
  if (params.get('product')) openProduct(Number(params.get('product'))).catch(() => {});
})();
