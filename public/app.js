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
async function openPage(key) {
  if (key === 'delivery') {
    show('page');
    $('#pageContent').innerHTML = '<h2>أسعار التوصيل</h2><p class="muted">جارٍ التحميل…</p>';
    try {
      const { coverage } = await api('/api/delivery-coverage');
      $('#pageContent').innerHTML = `<h2>أسعار التوصيل حسب الولاية</h2>
      <p>الجدول يعرض <strong>أرخص رسم توصيل متاح</strong> لكل ولاية عبر موردينا النشطين. الرسم الدقيق لطلبك يظهر في صفحة كل منتج وفي سلة الطلب قبل التأكيد، لأنه يختلف حسب المورد.</p>
      ${coverage.length ? `<div class="tablewrap"><table><tr><th>الولاية</th><th>أرخص توصيل</th><th>موردون يغطونها</th></tr>${coverage.map((c) => `<tr><td>${c.wilaya_code} — ${esc(c.name_ar)}</td><td>${fmt(c.min_fee)}</td><td>${c.suppliers}</td></tr>`).join('')}</table></div>` : '<p class="muted">لا توجد تغطية مضبوطة بعد — تُبنى القائمة تلقائياً من تغطية الموردين.</p>'}`;
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
function productCard(p) {
  return `
    <article class="pcard">
      ${p.images && p.images.length ? `<img src="${esc(p.images[0])}" alt="${esc(p.name)}" loading="lazy">` : '<div class="noimg">📦</div>'}
      <div class="pcard-body">
        <h3>${esc(p.name)}</h3>
        <span class="muted small">${esc(p.category_name || '')}</span>
        <span class="price">${fmt(p.customer_price)}</span>
        ${p.stock > 0 ? '<span class="badge">متوفر</span>' + (p.stock <= 3 ? ' <span class="badge out">بقي ' + p.stock + ' فقط</span>' : '') : '<span class="badge out">نفد المخزون</span>'}
        ${p.sold > 0 ? `<span class="badge">بيعت ${p.sold} مرة</span>` : ''}
        <button class="btn" data-view="${p.id}">عرض التفاصيل</button>
        <button class="btn gold" data-add="${p.id}" ${p.stock <= 0 ? 'disabled' : ''}>أضف إلى السلة</button>
        <button class="btn light" data-fav="${p.id}">${FAVS.has(p.id) ? '❤️ في المفضلة' : '🤍 أضف للمفضلة'}</button>
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
  } else $('#catChips').innerHTML = '';
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
      <div class="drawer-head"><h3>📋 طلبية رقم ${esc(o.ref)}</h3><span><button class="btn small light" id="printReceipt" type="button">🖨 طباعة الوصل</button> <button class="icon-btn dark" id="closeOrderModal" type="button">✕</button></span></div>
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
        ${o.marketer !== undefined ? `<br>المسوق: ${o.marketer ? '<strong>' + esc(o.marketer.name) + '</strong> (رمز الإحالة: ' + esc(o.marketer.ref_code || '') + ')' : 'بيع مباشر بلا مسوق'}` : ''}</p></div>
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
  const w = window.open('', '_blank', 'width=720,height=900');
  if (!w) return toast('اسمح بالنوافذ المنبثقة للطباعة', true);
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>وصل طلبية ${esc(o.ref)}</title>
  <style>body{font-family:Tahoma,Arial;padding:24px;color:#122}h1{font-size:20px}table{width:100%;border-collapse:collapse;margin:12px 0}td,th{border:1px solid #bbb;padding:7px;text-align:right}.tot{text-align:left;font-weight:bold}</style></head><body>
  <h1>Promotion Dizad — وصل طلبية</h1>
  <p>رقم الطلبية: <strong>${esc(o.ref)}</strong><br>التاريخ: ${new Date(o.created_at).toLocaleString('ar-DZ')}<br>الحالة: ${esc(o.status_label)}</p>
  ${o.buyer_name ? `<p>المشتري: ${esc(o.buyer_name)} — ${esc(o.buyer_phone || '')}<br>الولاية: ${esc(o.wilaya_name)} · البلدية: ${esc(o.commune)}<br>العنوان: ${esc(o.address || '')}</p>` : ''}
  <table><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr>
  ${d.items.map((i) => `<tr><td>${esc(i.name)}${i.size ? ' · ' + esc(i.size) : ''}${i.color ? ' · ' + esc(i.color) : ''}</td><td>${i.qty}</td><td>${fmt(i.customer_price)}</td><td>${fmt(i.line_total)}</td></tr>`).join('')}</table>
  <p class="tot">مجموع المنتجات: ${fmt(o.subtotal)}<br>التوصيل: ${fmt(o.delivery_fee)}<br>الإجمالي عند الاستلام: ${fmt(o.total)}</p>
  <p>المورد: ${esc(o.supplier ? (o.supplier.business_name || o.supplier.name) : '')}</p>
  <p>شكراً لثقتكم — Promotion Dizad</p>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  w.document.close();
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
  marketer: 'حساب مسوق: روابط إحالة خاصة بك، عمولات موثقة، وتسويات — العمولة تُثبت بعد التسليم والتحصيل فقط.',
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
  if (ME) { $('#dashTitle').textContent = ME.role === 'admin' ? 'لوحتي' : 'لوحة ' + ({ supplier: 'المورد', marketer: 'المسوق', buyer: 'المشتري' }[ME.role] || ''); $('#dashUser').textContent = ME.name + ' · ' + ME.phone + ' · ' + ME.role; }
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
      <input id="pfCommune" value="${esc(ME.commune || '')}" placeholder="البلدية">
      <input id="pfAddress" value="${esc(ME.address || '')}" placeholder="العنوان">
      ${ME.role === 'supplier' ? `<input id="pfBusiness" value="${esc(ME.business_name || '')}" placeholder="اسم النشاط/المتجر">` : ''}
      <input id="pfTelegram" value="${esc(ME.telegram_chat_id || '')}" placeholder="معرّف تيليغرام الرقمي (لإشعارات فورية — اختياري)">
      ${ME.role === 'marketer' ? `<select id="pfPayMethod">
        <option value="">— طريقة استلام أرباحك —</option>
        ${['بريدي موب', 'CCP', 'Flexy', 'نقداً عند الاستلام من الإدارة', 'أخرى'].map((m) => `<option ${ME.payment_method === m ? 'selected' : ''}>${m}</option>`).join('')}
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
  box.innerHTML = `<div class="card"><h3>طلباتي</h3>${orders.length ? `<div class="tablewrap"><table>
    <tr><th>الرقم</th><th>الحالة</th><th>الإجمالي</th><th>التاريخ</th><th></th></tr>
    ${orders.map((o) => `<tr><td>${esc(o.ref)}</td><td>${esc(o.status_label)}</td><td>${fmt(o.total)}</td><td>${new Date(o.created_at).toLocaleDateString('ar-DZ')}</td>
    <td><button class="btn small light" data-details="${o.id}">📋 التفاصيل</button> <button class="btn small" data-reorder="${o.id}">🔁 اطلب مجدداً</button> ${o.status === 'pending_supplier' ? `<button class="btn small danger" data-cancel="${o.id}">إلغاء</button>` : ''}</td></tr>`).join('')}</table></div>` : '<p class="muted">لا توجد طلبات بعد.</p>'}</div>`;
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
    <tr><th>المنتج</th><th>سعر الزبون</th><th>هامش المنصة</th><th>عمولتك</th><th>المخزون</th><th>رابطك</th><th>مشاركة</th><th>مواد التسويق</th></tr>
    ${products.map((p) => `<tr><td>${esc(p.name)}</td><td>${fmt(p.customer_price)}</td><td>${fmt(p.platform_margin)}</td><td><strong>${fmt(p.marketer_commission)}</strong></td>
      <td>${p.stock > 0 ? p.stock : '<span class="badge out">نافد</span>'}</td>
      <td><button class="btn small" data-link="${p.id}">إنشاء / نسخ رابط الإحالة</button></td>
      <td><button class="btn small light" data-share="${p.id}">مشاركة</button></td>
      <td><button class="btn small light" data-copydesc="${p.id}">📋 نسخ الوصف</button> <button class="btn small light" data-dlimgs="${p.id}">⬇️ الصور</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">لا منتجات معتمدة بعد</td></tr>'}</table></div>
    <p class="muted small">قاعدة الإحالة: آخر رابط صالح نقره المشتري خلال 30 يوماً هو المعتمد.</p></div>
  <div class="card"><h3>روابطي ونقراتها</h3>${links.length ? links.map((l) => `<p><code>${location.origin}/r/${l.code}</code> — ${l.product_id ? 'منتج #' + l.product_id : 'رابط عام'} — نقرات: ${l.clicks} ${l.product_id ? `<button class="btn small light" data-copymsg="${l.id}">📋 نسخ رسالة مشاركة جاهزة</button>` : ''}</p>`).join('') : '<p class="muted">لا روابط بعد.</p>'}</div>
  <div class="card"><h3>طلباتي وحالاتها</h3>${orders.length ? `<div class="tablewrap"><table><tr><th>الرقم</th><th>الحالة</th><th>الإجمالي</th><th></th></tr>${orders.map((o) => `<tr><td>${esc(o.ref)}</td><td>${esc(o.status_label)}</td><td>${fmt(o.total)}</td><td><button class="btn small light" data-details="${o.id}">📋 التفاصيل</button></td></tr>`).join('')}</table></div>` : '<p class="muted">لا طلبات بعد.</p>'}</div>
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
  $$('#dashContent [data-copymsg]').forEach((b) => b.addEventListener('click', async () => {
    const l = links.find((x) => x.id === Number(b.dataset.copymsg));
    const p = products.find((x) => x.id === l.product_id);
    const full = location.origin + '/r/' + l.code;
    const msg = `🔥 ${p ? p.name : 'منتج مميز'} — ${p ? fmt(p.customer_price) : ''}\nجودة مضمونة والدفع عند الاستلام 🚚💵\nاطلب من هنا: ${full}`;
    await navigator.clipboard.writeText(msg).catch(() => {});
    toast('نُسخت الرسالة الجاهزة مع رابطك — الصقها أين تشاء');
  }));
  $$('#dashContent [data-copydesc]').forEach((b) => b.addEventListener('click', async () => {
    const p = products.find((x) => x.id === Number(b.dataset.copydesc));
    const r = await api('/api/marketer/links', { method: 'POST', body: { productId: p.id } });
    const full = location.origin + r.link.path;
    const txt = `${p.name}\n${p.description || ''}\n💰 السعر: ${fmt(p.customer_price)} — الدفع عند الاستلام\nاطلب من هنا: ${full}`;
    await navigator.clipboard.writeText(txt).catch(() => {});
    toast('نُسخ الوصف التسويقي مع رابطك');
  }));
  $$('#dashContent [data-dlimgs]').forEach((b) => b.addEventListener('click', () => {
    const p = products.find((x) => x.id === Number(b.dataset.dlimgs));
    if (!p.images || !p.images.length) return toast('لا صور لهذا المنتج', true);
    p.images.forEach((im, i) => setTimeout(() => { const a = document.createElement('a'); a.href = im; a.target = '_blank'; a.rel = 'noopener'; a.click(); }, i * 350));
    toast('تُفتح ' + p.images.length + ' صورة — احفظ ما تحتاجه لإعلانك');
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
      <p><button class="btn small light" data-details="${o.id}">📋 التفاصيل الكاملة للطلبية</button></p>
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
$('#closeCart').addEventListener('click', () => { $('#cartDrawer').hidden = true; });
$('#coWilaya').addEventListener('change', updateTotals);
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
$('#bellBtn').addEventListener('click', async () => {
  const panel = $('#bellPanel');
  if (!panel.hidden) { panel.hidden = true; return; }
  panel.innerHTML = '<div class="bell-box"><p class="muted">جارٍ التحميل…</p></div>';
  panel.hidden = false;
  try {
    const { notifications } = await api('/api/my/notifications');
    panel.innerHTML = `<div class="bell-box"><h4>🔔 إشعاراتي</h4>${notifications.length ? notifications.map((n) => `<div class="bell-item"><p>${esc(n.text)}</p><span class="muted small">${new Date(n.created_at).toLocaleString('ar-DZ')} · ${esc(n.channel)} · ${esc(n.status)}</span></div>`).join('') : '<p class="muted">لا إشعارات بعد.</p>'}</div>`;
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
