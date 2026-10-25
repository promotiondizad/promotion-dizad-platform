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
  if (!res.ok) throw new Error(data.error || ('خطأ ' + res.status));
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
  how: `<h2>كيف نعمل — وكيف تتحرك الأموال بوضوح</h2>
  <p><strong>الأدوار:</strong> المورد يوفّر المنتج والمخزون ويجهّز الطلبية، والمسوق يجلب الطلبات عبر روابط إحالته مقابل عمولة، والمشتري يطلب ويدفع عند الاستلام، والمنصة تدير العرض والطلبات والإحالات وحساب العمولات آلياً.</p>
  <h3>مسار الأموال (اتفاق موثق)</h3>
  <ol>
    <li>الزبون يدفع المبلغ الإجمالي <strong>نقداً عند الاستلام</strong> لشركة التوصيل المتعاقدة مع المورد — <strong>المنصة لا تستلم أموال الزبائن أبداً</strong>.</li>
    <li>المورد يستلم مستحقاته من شركة توصيله حسب اتفاقه معها.</li>
    <li>المنصة تسجّل لكل طلب: سعر الجملة للمورد، هامش المنصة، وعمولة المسوق — كما كانت وقت إنشاء الطلب (لا تتغير بتغيّر الأسعار لاحقاً).</li>
    <li>عمولة المسوق تبقى «متوقعة» ولا تصبح مستحقة إلا بعد <strong>التسليم والتحصيل الفعلي</strong>، ثم تُسوّى بطلب تسوية يوافق عليه صاحب المنصة ويوثَّق بطريقة الدفع ومرجعه.</li>
    <li>حصة المنصة (الهامش ناقص عمولة المسوق) التزام مسجل على المورد يُسوّى معه دورياً وفق الاتفاق الثنائي بينهما — التسجيل في المنصة هو المرجع القابل للمراجعة للطرفين.</li>
  </ol>
  <h3>مثال حسابي</h3>
  <p>سعر الجملة 3000 دج + هامش المنصة 500 دج = سعر الزبون 3500 دج، + توصيل 500 دج = الإجمالي 4000 دج. عمولة المسوق 200 دج من الهامش، ويبقى للمنصة 300 دج قبل مصاريفها.</p>
  <h3>التوصيل</h3>
  <p>المورد مسؤول عن التجهيز والتنسيق مع شركة التوصيل التي يتعامل معها. المنصة تنظّم الطلبات وتعرض حالاتها، ولا تدّعي وجود عقد توصيل أو تكامل غير موجود.</p>`,
  terms: `<h2>الشروط والأحكام</h2>
  <h3>قواعد الإحالة والعمولات</h3>
  <ul>
    <li>كل مسوق له روابط إحالة فريدة. يُنسب الطلب للمسوق صاحب <strong>آخر رابط صالح نقره المشتري خلال 30 يوماً</strong> قبل الطلب (آخر نقرة تكسب).</li>
    <li>إذا استُخدمت روابط عدة مسوقين، تُعتمد قاعدة «آخر نقرة» وحدها — لا تُقسَّم العمولة.</li>
    <li>لا تُنسب عمولة لمسوق اشترى هو نفسه عبر رابطه.</li>
    <li>العمولة «متوقعة» عند إنشاء الطلب، وتُثبَّت «مستحقة» فقط بعد حالة «تم التسليم والتحصيل». الطلبات الملغاة أو المرتجعة أو المتعذرة <strong>لا تولّد أرباحاً نهائية</strong> وتُلغى عمولاتها آلياً.</li>
    <li>تُدفع العمولات عبر طلبات تسوية داخل المنصة، وتوثَّق طريقة الدفع ومرجعها عند الدفع الفعلي خارج المنصة (CCP/Flexy/نقداً حسب الاتفاق).</li>
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
  contact: `<h2>الدعم والتواصل</h2>
  <p>راسلنا عبر النموذج أو مباشرة: <a href="https://wa.me/213791402649" target="_blank" rel="noopener">واتساب</a> · <a href="https://www.facebook.com/promotion.dizad" target="_blank" rel="noopener">صفحة فيسبوك Promotion Dizad</a></p>
  <form id="supportForm" class="stack">
    <input id="spName" placeholder="الاسم" required>
    <input id="spPhone" placeholder="رقم الهاتف" required>
    <textarea id="spMsg" placeholder="رسالتك…" required></textarea>
    <button class="btn gold" type="submit">إرسال</button>
  </form>`
};
function openPage(key) {
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
async function loadProducts() {
  const q = $('#searchInput').value.trim(), cat = $('#catFilter').value;
  const data = await api('/api/products?' + new URLSearchParams({ search: q, category: cat }));
  PRODUCTS = data.products;
  const [min, max] = ($('#priceFilter').value || '-').split('-').map(Number);
  const list = PRODUCTS.filter((p) => !$('#priceFilter').value || (p.customer_price >= min && p.customer_price <= max));
  $('#productGrid').innerHTML = list.length ? list.map((p) => `
    <article class="pcard">
      ${p.images && p.images.length ? `<img src="${esc(p.images[0])}" alt="${esc(p.name)}" loading="lazy">` : '<div class="noimg">📦</div>'}
      <div class="pcard-body">
        <h3>${esc(p.name)}</h3>
        <span class="muted small">${esc(p.category_name || '')}</span>
        <span class="price">${fmt(p.customer_price)}</span>
        ${p.stock > 0 ? '<span class="badge">متوفر</span>' : '<span class="badge out">نفد المخزون</span>'}
        <button class="btn" data-view="${p.id}">عرض التفاصيل</button>
        <button class="btn gold" data-add="${p.id}" ${p.stock <= 0 ? 'disabled' : ''}>أضف إلى السلة</button>
      </div>
    </article>`).join('') : '<p class="muted">لا توجد منتجات معتمدة معروضة حالياً. المنتجات تظهر هنا بعد مراجعة الإدارة للموردين ومنتجاتهم.</p>';
  $$('#productGrid [data-view]').forEach((b) => b.addEventListener('click', () => openProduct(Number(b.dataset.view))));
  $$('#productGrid [data-add]').forEach((b) => b.addEventListener('click', () => { addToCart(Number(b.dataset.add), 1); }));
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
    <p class="price">${fmt(p.customer_price)} ${p.stock > 0 ? '<span class="badge">متوفر — مخزون ' + p.stock + '</span>' : '<span class="badge out">نفد المخزون</span>'}</p>
    ${p.sizes.length ? `<label>المقاس <select id="pmSize">${p.sizes.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>` : ''}
    ${p.colors.length ? `<label>اللون <select id="pmColor">${p.colors.map((s) => `<option>${esc(s)}</option>`).join('')}</select></label>` : ''}
    <label>الكمية <input type="number" id="pmQty" value="1" min="1" max="99"></label>
    <details><summary>الولايات المتوفرة وتكلفة التوصيل لكل ولاية</summary>
      <div class="kv">${p.coverage.length ? p.coverage.map((c) => `<span>${wilayaName(c.wilaya_code)}: ${fmt(c.delivery_fee)}</span>`).join('') : '<span class="muted">لم يضبط المورد تغطية التوصيل بعد</span>'}</div>
    </details>
    <div class="share-row">
      <a class="btn light small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(p.name + ' — ' + fmt(p.customer_price) + ' ' + pageUrl)}">مشاركة واتساب</a>
      <a class="btn light small" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(p.name)}">مشاركة تيليغرام</a>
      <a class="btn light small" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}">مشاركة فيسبوك</a>
      <a class="btn light small" target="_blank" rel="noopener" href="https://m.me/promotion.dizad">مراسلة الصفحة</a>
    </div>
    <button class="btn gold big" id="pmAdd" ${p.stock <= 0 ? 'disabled' : ''}>أضف إلى السلة</button>`;
  $('#productModal').hidden = false;
  $('#pmClose').addEventListener('click', () => { $('#productModal').hidden = true; });
  $$('#productModalBox [data-g]').forEach((im) => im.addEventListener('click', () => {
    $('#pmMain').src = im.src; $$('#productModalBox [data-g]').forEach((x) => x.classList.remove('sel')); im.classList.add('sel');
  }));
  $('#pmAdd').addEventListener('click', () => {
    addToCart(p.id, Number($('#pmQty').value) || 1, $('#pmSize')?.value, $('#pmColor')?.value);
    $('#productModal').hidden = true;
  });
}
function wilayaName(code) { const w = WILAYAS.find((x) => x.code === Number(code)); return w ? w.code + ' — ' + w.name_ar : code; }
function currentRef() {
  try {
    const r = JSON.parse(localStorage.getItem('pd_ref') || 'null');
    if (r && r.code && Date.now() - r.at < 30 * 24 * 3600e3) return r.code;
  } catch {}
  return null;
}

// ---------- السلة والطلب ----------
function saveCart() { localStorage.setItem('pd_cart', JSON.stringify(CART)); renderCartBadge(); }
function renderCartBadge() {
  const n = CART.reduce((a, i) => a + i.qty, 0);
  $('#cartCount').hidden = n === 0; $('#cartCount').textContent = n;
}
function addToCart(productId, qty, size, color) {
  const p = PRODUCTS.find((x) => x.id === productId);
  const ex = CART.find((i) => i.productId === productId && i.size === size && i.color === color);
  if (ex) ex.qty += qty; else CART.push({ productId, qty, size: size || null, color: color || null, name: p ? p.name : ('منتج ' + productId), price: p ? p.customer_price : 0, image: p && p.images ? p.images[0] : null, supplier_id: p ? p.supplier_id : null });
  checkoutKey = null; sessionStorage.removeItem('pd_checkout_key');
  saveCart(); toast('أُضيف إلى السلة');
}
async function renderCart() {
  const box = $('#cartItems');
  if (!CART.length) { box.innerHTML = '<p class="muted">السلة فارغة.</p>'; const t = $('#coTotals'); t.innerHTML = ''; t.hidden = true; return; }
  box.innerHTML = CART.map((i, idx) => `
    <div class="cart-item">
      ${i.image ? `<img src="${esc(i.image)}" alt="">` : ''}
      <div style="flex:1"><strong>${esc(i.name)}</strong><br><span class="muted small">${i.size ? 'مقاس ' + esc(i.size) + ' · ' : ''}${i.color ? esc(i.color) + ' · ' : ''}${fmt(i.price)}</span></div>
      <div class="qty"><button data-dec="${idx}" type="button">−</button><span>${i.qty}</span><button data-inc="${idx}" type="button">+</button></div>
      <button class="icon-btn dark" data-del="${idx}" type="button">حذف</button>
    </div>`).join('');
  $$('#cartItems [data-inc]').forEach((b) => b.addEventListener('click', () => { CART[+b.dataset.inc].qty++; saveCart(); renderCart(); }));
  $$('#cartItems [data-dec]').forEach((b) => b.addEventListener('click', () => { const it = CART[+b.dataset.dec]; it.qty = Math.max(1, it.qty - 1); saveCart(); renderCart(); }));
  $$('#cartItems [data-del]').forEach((b) => b.addEventListener('click', () => { CART.splice(+b.dataset.del, 1); saveCart(); renderCart(); }));
  await updateTotals();
}
async function updateTotals() {
  $('#coTotals').hidden = false;
  const w = Number($('#coWilaya').value);
  const subtotal = CART.reduce((a, i) => a + i.price * i.qty, 0);
  let html = `<div>مجموع المنتجات: <strong>${fmt(subtotal)}</strong></div>`;
  if (w) {
    try {
      const fees = {};
      for (const i of CART) {
        const { product } = await api('/api/products/' + i.productId);
        const cov = product.coverage.find((c) => c.wilaya_code === w);
        fees[product.supplier_id] = cov ? cov.delivery_fee : null;
      }
      let delivery = 0, missing = false;
      for (const f of Object.values(fees)) { if (f === null) missing = true; else delivery += f; }
      if (missing) html += '<div class="muted">⚠️ أحد الموردين لا يغطي هذه الولاية — سيُرفض الطلب عند التأكيد.</div>';
      else html += `<div>التوصيل: <strong>${fmt(delivery)}</strong></div><div class="grand">الإجمالي عند الاستلام: ${fmt(subtotal + delivery)}</div>`;
    } catch { html += '<div class="muted">تعذر حساب التوصيل الآن — سيُحسب نهائياً في الخادم عند التأكيد.</div>'; }
  } else html += '<div class="muted">اختر الولاية لحساب التوصيل والإجمالي.</div>';
  $('#coTotals').innerHTML = html;
}

// ---------- المصادقة ----------
let regRole = 'buyer';
const ROLE_HINTS = {
  buyer: 'حساب مشتري: اطلب وتابع طلباتك وسجل مشترياتك.',
  marketer: 'حساب مسوق: روابط إحالة خاصة بك، عمولات موثقة، وتسويات — العمولة تُثبت بعد التسليم والتحصيل فقط.',
  supplier: 'حساب مورد: تُراجع الإدارة حسابك أولاً، ثم تنشر منتجاتك وتستقبل الطلبات الموجهة إليك آلياً.'
};
function selectRole(r) {
  regRole = r;
  $$('.role-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.role === r));
  $('#roleHint').textContent = ROLE_HINTS[r];
  $('#supplierFields').hidden = r !== 'supplier';
  $('#marketerFields').hidden = r !== 'marketer';
}
async function refreshMe() {
  const data = await api('/api/me');
  ME = data.user; CSRF = data.csrf || CSRF;
  $('#authBtn').hidden = !!ME;
  $('#dashBtn').hidden = !ME; $('#logoutBtn').hidden = !ME;
  if (ME) { $('#dashTitle').textContent = 'لوحة ' + ({ admin: 'الإدارة العامة', supplier: 'المورد', marketer: 'المسوق', buyer: 'المشتري' }[ME.role] || ''); $('#dashUser').textContent = ME.name + ' · ' + ME.phone + ' · ' + ME.role; }
  return ME;
}

// ---------- لوحات التحكم ----------
const STATUS_FLOW = ['pending_supplier', 'confirmed', 'preparing', 'handed', 'out_for_delivery', 'delivered_collected', 'failed_delivery', 'returned', 'cancelled', 'rejected'];
const STATUS_AR = { pending_supplier: 'جديد — بانتظار تأكيد المورد', confirmed: 'مؤكد', preparing: 'قيد التجهيز', handed: 'سُلّم لشركة التوصيل', out_for_delivery: 'خرج للتوصيل', delivered_collected: 'تم التسليم والتحصيل', cancelled: 'أُلغي', rejected: 'مرفوض', failed_delivery: 'تعذر التسليم', returned: 'مرتجع' };

async function renderDash() {
  if (!ME) return openAuth('login');
  show('dash');
  const box = $('#dashContent');
  if (ME.role === 'buyer') return renderBuyer(box);
  if (ME.role === 'marketer') return renderMarketer(box);
  if (ME.role === 'supplier') return renderSupplier(box);
  if (ME.role === 'admin') return renderAdmin(box);
}
async function renderBuyer(box) {
  const { orders } = await api('/api/my/orders');
  box.innerHTML = `<div class="card"><h3>طلباتي</h3>${orders.length ? `<div class="tablewrap"><table>
    <tr><th>الرقم</th><th>الحالة</th><th>الإجمالي</th><th>التاريخ</th><th></th></tr>
    ${orders.map((o) => `<tr><td>${esc(o.ref)}</td><td>${esc(o.status_label)}</td><td>${fmt(o.total)}</td><td>${new Date(o.created_at).toLocaleDateString('ar-DZ')}</td>
    <td>${o.status === 'pending_supplier' ? `<button class="btn small danger" data-cancel="${o.id}">إلغاء</button>` : ''}</td></tr>`).join('')}</table></div>` : '<p class="muted">لا توجد طلبات بعد.</p>'}</div>`;
  $$('#dashContent [data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/my/orders/${b.dataset.cancel}/cancel`, { method: 'POST', body: {} }); toast('أُلغي الطلب'); renderDash(); }
    catch (e) { toast(e.message, true); }
  }));
}
async function renderMarketer(box) {
  const [{ products }, { commissions, sums, settlements }, { links }, { orders }] = await Promise.all([
    api('/api/marketer/products'), api('/api/marketer/commissions'), api('/api/marketer/links'), api('/api/marketer/orders')
  ]);
  box.innerHTML = `
  <div class="stat-grid">
    <div class="stat">عمولات متوقعة<b>${fmt(sums.expected)}</b></div>
    <div class="stat">عمولات مستحقة للتسوية<b>${fmt(sums.payable)}</b></div>
    <div class="stat">عمولات مدفوعة<b>${fmt(sums.paid)}</b></div>
    <div class="stat">طلبات جلبتها<b>${orders.length}</b></div>
  </div>
  <div class="card"><h3>منتجات متاحة للتسويق</h3><div class="tablewrap"><table>
    <tr><th>المنتج</th><th>سعر الزبون</th><th>هامش المنصة</th><th>عمولتك</th><th>المخزون</th><th>رابطك</th><th>مشاركة</th></tr>
    ${products.map((p) => `<tr><td>${esc(p.name)}</td><td>${fmt(p.customer_price)}</td><td>${fmt(p.platform_margin)}</td><td><strong>${fmt(p.marketer_commission)}</strong></td>
      <td>${p.stock > 0 ? p.stock : '<span class="badge out">نافد</span>'}</td>
      <td><button class="btn small" data-link="${p.id}">إنشاء / نسخ رابط الإحالة</button></td>
      <td><button class="btn small light" data-share="${p.id}">مشاركة</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">لا منتجات معتمدة بعد</td></tr>'}</table></div>
    <p class="muted small">قاعدة الإحالة: آخر رابط صالح نقره المشتري خلال 30 يوماً هو المعتمد.</p></div>
  <div class="card"><h3>روابطي ونقراتها</h3>${links.length ? links.map((l) => `<p><code>${location.origin}/r/${l.code}</code> — ${l.product_id ? 'منتج #' + l.product_id : 'رابط عام'} — نقرات: ${l.clicks}</p>`).join('') : '<p class="muted">لا روابط بعد.</p>'}</div>
  <div class="card"><h3>طلباتي وحالاتها</h3>${orders.length ? `<div class="tablewrap"><table><tr><th>الرقم</th><th>الحالة</th><th>الإجمالي</th></tr>${orders.map((o) => `<tr><td>${esc(o.ref)}</td><td>${esc(o.status_label)}</td><td>${fmt(o.total)}</td></tr>`).join('')}</table></div>` : '<p class="muted">لا طلبات بعد.</p>'}</div>
  <div class="card"><h3>عمولاتي وتسوياتي</h3>
    ${commissions.length ? `<div class="tablewrap"><table><tr><th>الطلب</th><th>العمولة</th><th>الحالة</th></tr>${commissions.map((c) => `<tr><td>${esc(c.ref)}</td><td>${fmt(c.amount)}</td><td>${({ expected: 'متوقعة', confirmed: 'مثبتة', payable: 'مستحقة', paid: 'مدفوعة', cancelled: 'ملغاة' })[c.state]}</td></tr>`).join('')}</table></div>` : '<p class="muted">لا عمولات بعد.</p>'}
    <button class="btn gold" id="reqSettle" ${sums.payable <= 0 ? 'disabled' : ''}>طلب تسوية المستحقات (${fmt(sums.payable)})</button>
    ${settlements.length ? `<h4>طلبات التسوية</h4>${settlements.map((s) => `<p>#${s.id} — ${fmt(s.amount)} — ${({ requested: 'قيد المراجعة', approved: 'موافق عليها', paid: 'مدفوعة' + (s.reference ? ' · مرجع: ' + esc(s.reference) : ''), rejected: 'مرفوضة' })[s.state]}</p>`).join('')}` : ''}
  </div>`;
  $$('#dashContent [data-link]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const r = await api('/api/marketer/links', { method: 'POST', body: { productId: Number(b.dataset.link) } });
      const full = location.origin + r.link.path;
      await navigator.clipboard.writeText(full).catch(() => {});
      toast('رابط الإحالة: ' + full + ' (نُسخ إن سمح المتصفح)');
      renderDash();
    } catch (e) { toast(e.message, true); }
  }));
  $$('#dashContent [data-share]').forEach((b) => b.addEventListener('click', async () => {
    const p = products.find((x) => x.id === Number(b.dataset.share));
    const r = await api('/api/marketer/links', { method: 'POST', body: { productId: p.id } });
    const full = location.origin + r.link.path;
    const text = encodeURIComponent(p.name + ' — ' + fmt(p.customer_price));
    window.open(`https://wa.me/?text=${text}%20${encodeURIComponent(full)}`, '_blank');
  }));
  const rs = $('#reqSettle');
  if (rs) rs.addEventListener('click', async () => {
    try { const r = await api('/api/marketer/settlements', { method: 'POST', body: {} }); toast('أُنشئ طلب التسوية #' + r.settlementId + ' بمبلغ ' + fmt(r.amount)); renderDash(); }
    catch (e) { toast(e.message, true); }
  });
}
async function renderSupplier(box) {
  const [{ products }, { orders }, { coverage }, reports, { categories }] = await Promise.all([
    api('/api/supplier/products'), api('/api/supplier/orders'), api('/api/supplier/coverage'), api('/api/supplier/reports'), api('/api/categories')
  ]);
  const covMap = Object.fromEntries(coverage.map((c) => [c.wilaya_code, c.delivery_fee]));
  box.innerHTML = `
  <div class="stat-grid">
    <div class="stat">طلبات جديدة<b>${orders.filter((o) => o.status === 'pending_supplier').length}</b></div>
    <div class="stat">مبيعات مسلّمة ومحصّلة<b>${fmt(reports.delivered.sum)}</b></div>
    <div class="stat">منتجاتي<b>${products.length}</b></div>
    <div class="stat">تنبيه مخزون منخفض<b>${reports.lowStock.length}</b></div>
  </div>
  ${ME.status !== 'active' ? '<div class="card"><p>⏳ حسابك قيد مراجعة الإدارة — ستتمكن من النشر واستقبال الطلبات بعد التفعيل.</p></div>' : ''}
  <div class="card"><h3>إضافة منتج</h3>
    <form id="prodForm" class="stack">
      <input id="pfName" placeholder="اسم المنتج" required>
      <textarea id="pfDesc" placeholder="الوصف الكامل"></textarea>
      <div class="row-form">
        <input id="pfWholesale" type="number" min="0" placeholder="سعر الجملة (دج)" required>
        <input id="pfStock" type="number" min="0" placeholder="المخزون" required>
        <select id="pfCat"><option value="">تصنيف…</option>${categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      </div>
      <div class="row-form"><input id="pfSizes" placeholder="المقاسات مفصولة بفواصل (اختياري)"><input id="pfColors" placeholder="الألوان مفصولة بفواصل (اختياري)"></div>
      <label>صور المنتج (حتى 6 — تحميل من جهازك أو روابط)</label>
      <input id="pfFiles" type="file" accept="image/*" multiple>
      <input id="pfImgUrls" placeholder="روابط صور إضافية مفصولة بفواصل (اختياري)">
      <div class="gallery" id="pfPreview"></div>
      <button class="btn gold" type="submit">إرسال المنتج لمراجعة الإدارة</button>
      <p class="muted small">سعر الزبون = سعر الجملة + هامش المنصة الذي تحدده الإدارة عند الاعتماد. المنتج لا يظهر قبل الاعتماد.</p>
    </form></div>
  <div class="card"><h3>منتجاتي</h3>${products.length ? `<div class="tablewrap"><table>
    <tr><th>المنتج</th><th>الجملة</th><th>هامش المنصة</th><th>عمولة المسوق</th><th>سعر الزبون</th><th>المخزون</th><th>الحالة</th><th></th></tr>
    ${products.map((p) => `<tr><td>${esc(p.name)}</td><td>${fmt(p.wholesale_price)}</td><td>${fmt(p.platform_margin)}</td><td>${fmt(p.marketer_commission)}</td><td>${fmt(p.customer_price)}</td><td>${p.stock}</td>
      <td>${({ pending_review: 'بانتظار المراجعة', approved: 'معتمد', rejected: 'مرفوض' + (p.reject_reason ? ': ' + esc(p.reject_reason) : ''), paused: 'موقوف' })[p.status]}</td>
      <td>${p.status === 'approved' ? `<button class="btn small light" data-pause="${p.id}">إيقاف مؤقت</button>` : ''}${p.status === 'paused' ? `<button class="btn small" data-resume="${p.id}">إعادة تفعيل</button>` : ''}</td></tr>`).join('')}</table></div>` : '<p class="muted">لا منتجات بعد.</p>'}</div>
  <div class="card"><h3>طلباتي الواردة</h3>${orders.length ? orders.map((o) => `
    <details><summary>${esc(o.ref)} — ${esc(o.status_label)} — ${fmt(o.total)} — ${esc(o.guest_name || '')} (${esc(o.guest_phone || '')}) — ${wilayaName(o.wilaya)} / ${esc(o.commune)}</summary>
      <p>${o.items.map((i) => `${esc(i.name)} × ${i.qty} — ${fmt(i.customer_price * i.qty)}`).join('<br>')}</p>
      <p class="muted">العنوان: ${esc(o.address)} · التوصيل: ${fmt(o.delivery_fee)}${o.reject_reason ? ' · سبب الرفض: ' + esc(o.reject_reason) : ''}</p>
      <div class="row-form">
        <select id="st-${o.id}">${STATUS_FLOW.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${STATUS_AR[s]}</option>`).join('')}</select>
        <input id="rs-${o.id}" placeholder="سبب (إلزامي عند الرفض/الإلغاء)">
        <button class="btn small" data-status="${o.id}">تحديث الحالة</button>
      </div>
    </details>`).join('') : '<p class="muted">لا طلبات بعد.</p>'}</div>
  <div class="card"><h3>تغطية الولايات وتكلفة التوصيل</h3>
    <p class="muted small">فعّل الولايات التي تغطيها وحدد تكلفة التوصيل لكل واحدة. الطلبات إلى ولايات غير مغطاة تُرفض آلياً.</p>
    <form id="covForm"><div class="kv">${WILAYAS.map((w) => `<label class="check"><input type="checkbox" data-cov="${w.code}" ${covMap[w.code] !== undefined ? 'checked' : ''}> ${w.code} — ${esc(w.name_ar)} <input type="number" min="0" data-fee="${w.code}" value="${covMap[w.code] ?? ''}" placeholder="دج" style="width:90px"></label>`).join('')}</div>
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
  $('#covForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const coverage = $$('#covForm [data-cov]:checked').map((cb) => ({ wilaya_code: Number(cb.dataset.cov), delivery_fee: Number($(`#covForm [data-fee="${cb.dataset.cov}"]`).value) || 0 }));
    try { await api('/api/supplier/coverage', { method: 'PUT', body: { coverage } }); toast('حُفظت تغطية التوصيل'); }
    catch (err) { toast(err.message, true); }
  });
}

async function renderAdmin(box) {
  const [ov, users, products, orders, settlements, integ, notifs, support, auditL] = await Promise.all([
    api('/api/admin/overview'), api('/api/admin/users'), api('/api/admin/products'), api('/api/admin/orders'),
    api('/api/admin/settlements'), api('/api/admin/integrations'), api('/api/admin/notifications'), api('/api/admin/support'), api('/api/admin/audit')
  ]);
  const pendingSup = users.users.filter((u) => u.role === 'supplier' && u.status === 'pending');
  const pendingProd = products.products.filter((p) => p.status === 'pending_review');
  box.innerHTML = `
  <div class="stat-grid">
    <div class="stat">أرباح المنصة المثبتة<b>${fmt(ov.platformEarned)}</b></div>
    <div class="stat">عمولات مستحقة للمسوقين<b>${fmt(ov.marketerDue)}</b></div>
    <div class="stat">موردون بانتظار المراجعة<b>${ov.pendingSuppliers}</b></div>
    <div class="stat">منتجات بانتظار الاعتماد<b>${ov.pendingProducts}</b></div>
    <div class="stat">إشعارات فاشلة/غير مضبوطة<b>${ov.failedNotifications}</b></div>
    <div class="stat">طلبات متأخرة (+48 سا)<b>${ov.lateOrders.length}</b></div>
  </div>
  <div class="card"><h3>مراجعة الموردين</h3>${pendingSup.length ? pendingSup.map((u) => `
    <p><strong>${esc(u.name)}</strong> — ${esc(u.business_name || '')} — ${esc(u.phone)} — ${esc(u.activity || '')}
    <button class="btn small" data-uact="approve" data-uid="${u.id}">تفعيل</button>
    <button class="btn small danger" data-uact="reject" data-uid="${u.id}">رفض</button></p>`).join('') : '<p class="muted">لا موردين بانتظار المراجعة.</p>'}</div>
  <div class="card"><h3>اعتماد المنتجات وتحديد الهامش والعمولة</h3>${pendingProd.length ? pendingProd.map((p) => `
    <p><strong>${esc(p.name)}</strong> — المورد: ${esc(p.supplier_name)} — الجملة: ${fmt(p.wholesale_price)} — المخزون: ${p.stock}<br>
    هامش المنصة <input type="number" id="mg-${p.id}" value="500" style="width:100px"> عمولة المسوق <input type="number" id="cm-${p.id}" value="200" style="width:100px">
    <button class="btn small gold" data-papprove="${p.id}">اعتماد</button>
    <button class="btn small danger" data-preject="${p.id}">رفض</button></p>`).join('') : '<p class="muted">لا منتجات بانتظار الاعتماد.</p>'}
    <details><summary>كل المنتجات (${products.products.length})</summary><div class="tablewrap"><table><tr><th>المنتج</th><th>الحالة</th><th>الجملة</th><th>الهامش</th><th>العمولة</th><th>سعر الزبون</th><th>صافي المنصة</th></tr>
    ${products.products.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.status)}</td><td>${fmt(p.wholesale_price)}</td><td>${fmt(p.platform_margin)}</td><td>${fmt(p.marketer_commission)}</td><td>${fmt(p.customer_price)}</td><td>${fmt(p.platform_net)}</td></tr>`).join('')}</table></div></details></div>
  <div class="card"><h3>المستخدمون</h3><div class="tablewrap"><table><tr><th>الاسم</th><th>الدور</th><th>الهاتف</th><th>الحالة</th><th></th></tr>
    ${users.users.filter((u) => u.role !== 'admin').map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.role)}</td><td>${esc(u.phone)}</td><td>${esc(u.status)}</td>
    <td>${u.status === 'suspended' ? `<button class="btn small" data-uact="activate" data-uid="${u.id}">إعادة تفعيل</button>` : `<button class="btn small light" data-uact="suspend" data-uid="${u.id}">تعليق</button>`}</td></tr>`).join('')}</table></div></div>
  <div class="card"><h3>كل الطلبات ومصادرها</h3><div class="tablewrap"><table><tr><th>الرقم</th><th>الحالة</th><th>المورد</th><th>المسوق</th><th>الإجمالي</th></tr>
    ${orders.orders.slice(0, 60).map((o) => `<tr><td>${esc(o.ref)}</td><td>${esc(o.status_label)}</td><td>#${o.supplier_id}</td><td>${o.marketer_id ? '#' + o.marketer_id + ' (' + esc(o.ref_code || '') + ')' : 'مباشر'}</td><td>${fmt(o.total)}</td></tr>`).join('')}</table></div></div>
  <div class="card"><h3>تسويات المسوقين</h3>${settlements.settlements.length ? settlements.settlements.map((s) => `
    <p>#${s.id} — ${esc(s.marketer_name)} — ${fmt(s.amount)} — ${esc(s.state)} ${s.state === 'requested' || s.state === 'approved' ? `
    <input placeholder="طريقة الدفع" id="sm-${s.id}" style="width:110px"> <input placeholder="المرجع" id="sr-${s.id}" style="width:110px">
    <button class="btn small gold" data-spaid="${s.id}">تأكيد الدفع الفعلي</button> <button class="btn small danger" data-sreject="${s.id}">رفض</button>` : ''}</p>`).join('') : '<p class="muted">لا طلبات تسوية.</p>'}
    <p class="muted small">الدفع الفعلي يتم خارج المنصة (CCP/Flexy…) حسب الاتفاق — زر التأكيد يوثّق فقط ما حدث فعلاً بطريقته ومرجعه.</p></div>
  <div class="card"><h3>حالة التكاملات</h3>
    ${Object.entries(integ.integrations).map(([k, v]) => `<p><strong>${k}</strong>: ${v.configured ? '✅ مضبوط' : '⚠️ غير مضبوط'} — ${esc(v.note)}<br><span class="muted small">فاشلة/في الطابور: ${v.failedCount}${v.last ? ' · آخر محاولة: ' + esc(v.last.status) : ''}</span></p>`).join('')}
    <h4>الإشعارات الأخيرة</h4>${notifs.notifications.slice(0, 15).map((n) => `<p class="small">#${n.id} ${esc(n.channel)} · ${esc(n.type)} · ${esc(n.status)} · محاولات ${n.attempts}${n.last_error ? ' · ' + esc(n.last_error) : ''} <button class="btn small light" data-retry="${n.id}">إعادة المحاولة</button></p>`).join('')}</div>
  <div class="card"><h3>رسائل الدعم</h3>${support.messages.length ? support.messages.map((m) => `<p><strong>${esc(m.name)}</strong> (${esc(m.phone)}): ${esc(m.message)}</p>`).join('') : '<p class="muted">لا رسائل.</p>'}</div>
  <div class="card"><h3>أدوات</h3>
    <form id="catForm" class="row-form"><input id="catName" placeholder="تصنيف جديد"><button class="btn" type="submit">إضافة تصنيف</button></form>
    <p><button class="btn light" id="backupBtn" type="button">إنشاء نسخة احتياطية من قاعدة البيانات</button></p>
    <details><summary>سجل العمليات الإدارية (تدقيق)</summary>${auditL.logs.slice(0, 40).map((l) => `<p class="small">#${l.id} ${esc(l.action)} · ${esc(l.entity || '')} ${esc(l.entity_id || '')} · ${new Date(l.created_at).toLocaleString('ar-DZ')}</p>`).join('')}</details>
  </div>`;
  $$('#dashContent [data-uact]').forEach((b) => b.addEventListener('click', async () => {
    let reason = null;
    if (b.dataset.uact === 'reject') { reason = prompt('سبب الرفض:'); if (reason === null) return; }
    try { await api(`/api/admin/users/${b.dataset.uid}/action`, { method: 'POST', body: { action: b.dataset.uact, reason } }); toast('تم'); renderDash(); }
    catch (e) { toast(e.message, true); }
  }));
  $$('#dashContent [data-papprove]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.papprove;
    try { await api(`/api/admin/products/${id}/review`, { method: 'POST', body: { action: 'approve', platformMargin: Number($('#mg-' + id).value), marketerCommission: Number($('#cm-' + id).value) } }); toast('تم اعتماد المنتج'); renderDash(); }
    catch (e) { toast(e.message, true); }
  }));
  $$('#dashContent [data-preject]').forEach((b) => b.addEventListener('click', async () => {
    const reason = prompt('سبب رفض المنتج:'); if (reason === null) return;
    try { await api(`/api/admin/products/${b.dataset.preject}/review`, { method: 'POST', body: { action: 'reject', reason } }); toast('رُفض المنتج'); renderDash(); }
    catch (e) { toast(e.message, true); }
  }));
  $$('#dashContent [data-spaid]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.spaid;
    try { await api(`/api/admin/settlements/${id}/action`, { method: 'POST', body: { action: 'paid', method: $('#sm-' + id).value, reference: $('#sr-' + id).value } }); toast('وُثّق دفع التسوية'); renderDash(); }
    catch (e) { toast(e.message, true); }
  }));
  $$('#dashContent [data-sreject]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/admin/settlements/${b.dataset.sreject}/action`, { method: 'POST', body: { action: 'rejected', note: 'رفضته الإدارة' } }); toast('رُفضت التسوية'); renderDash(); }
    catch (e) { toast(e.message, true); }
  }));
  $$('#dashContent [data-retry]').forEach((b) => b.addEventListener('click', async () => {
    const r = await api(`/api/admin/notifications/${b.dataset.retry}/retry`, { method: 'POST', body: {} });
    toast(r.ok ? 'أُرسل الإشعار' : 'ما زال غير مُرسل: ' + (r.result.error || ''), !r.ok); renderDash();
  }));
  $('#catForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/admin/categories', { method: 'POST', body: { name: $('#catName').value } }); toast('أُضيف التصنيف'); renderDash(); }
    catch (err) { toast(err.message, true); }
  });
  $('#backupBtn').addEventListener('click', async () => {
    try { const r = await api('/api/admin/backup', { method: 'POST', body: {} }); toast('أُنشئت النسخة: ' + r.file); }
    catch (e) { toast(e.message, true); }
  });
}

// ---------- أحداث عامة ----------
function openAuth(tab = 'login', role) {
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
$('#closeCart').addEventListener('click', () => { $('#cartDrawer').hidden = true; });
$('#coWilaya').addEventListener('change', updateTotals);
$('#searchInput').addEventListener('input', () => loadProducts().catch(() => {}));
$('#catFilter').addEventListener('change', () => loadProducts().catch(() => {}));
$('#priceFilter').addEventListener('change', () => loadProducts().catch(() => {}));

$('#checkoutForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!CART.length) return toast('السلة فارغة', true);
  const btn = $('#checkoutBtn'); btn.disabled = true; btn.textContent = 'جارٍ إنشاء الطلب…';
  try {
    if (!checkoutKey) { checkoutKey = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()); sessionStorage.setItem('pd_checkout_key', checkoutKey); }
    const r = await api('/api/orders', { method: 'POST', body: {
      customer: { name: $('#coName').value, phone: $('#coPhone').value, wilaya: Number($('#coWilaya').value), commune: $('#coCommune').value, address: $('#coAddress').value },
      items: CART.map((i) => ({ productId: i.productId, qty: i.qty, size: i.size, color: i.color })),
      refCode: currentRef(), idempotencyKey: checkoutKey
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
      terms: $('#rgTerms').checked
    } });
    toast(r.message); e.target.reset(); openAuth('login');
  } catch (err) { toast(err.message, true); }
});
$('#forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { const r = await api('/api/auth/forgot', { method: 'POST', body: { phone: $('#fgPhone').value } }); toast(r.message); }
  catch (err) { toast(err.message, true); }
});
$('#resetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { const r = await api('/api/auth/reset', { method: 'POST', body: { token: $('#rsToken').value.trim(), password: $('#rsPass').value, passwordConfirm: $('#rsPass2').value } }); toast(r.message); openAuth('login'); }
  catch (err) { toast(err.message, true); }
});
$('#setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await api('/api/setup', { method: 'POST', body: { name: $('#suName').value, phone: $('#suPhone').value, password: $('#suPass').value } }); toast('أُنشئ حساب المدير — سجّل الدخول الآن'); $('#setupCard').hidden = true; openAuth('login'); }
  catch (err) { toast(err.message, true); }
});

// ---------- تشغيل ----------
(async function init() {
  const params = new URLSearchParams(location.search);
  if (params.get('ref')) {
    localStorage.setItem('pd_ref', JSON.stringify({ code: params.get('ref'), at: Date.now() }));
    $('#refBanner').hidden = false;
    $('#refBanner').textContent = 'وصلت عبر رابط مسوق — سيُنسب طلبك إليه تلقائياً إذا طلبت خلال 30 يوماً (قاعدة آخر نقرة).';
  }
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
