import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, collection, doc, addDoc, setDoc, getDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, serverTimestamp, Timestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { TEACHERS, STORES } from './data.js';

const app = initializeApp({
  apiKey: 'AIzaSyC_MlCzdRT0KBtdrFKNUAzD5kiH-CVo07M',
  authDomain: 'rdes07-89859.firebaseapp.com',
  projectId: 'rdes07-89859',
  storageBucket: 'rdes07-89859.firebasestorage.app',
  messagingSenderId: '426676002934',
  appId: '1:426676002934:web:81f18d96dbae516140bf57',
});
const db = getFirestore(app);

const $app = document.getElementById('app');
let unsubs = [];
const stopListening = () => { unsubs.forEach((u) => u()); unsubs = []; };

// ---------- 小工具 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = (id) => STORES.find((s) => s.id === id);
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const toDate = (t) => (t && t.toDate ? t.toDate() : null);
const pageUrl = () => location.href.split('#')[0];

const mem = {
  get(k) { try { return JSON.parse(localStorage.getItem('drinks.' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('drinks.' + k, JSON.stringify(v)); } catch { /* 沒辦法記也沒關係 */ } },
};

async function copy(text, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  if (btn) {
    const old = btn.textContent;
    btn.textContent = ok ? '已複製' : '複製失敗，請長按文字複製';
    setTimeout(() => { btn.textContent = old; }, 1800);
  }
}

function chips(name, options, selected, multi = false) {
  return `<div class="chips" data-group="${name}">${options.map((o) => {
    const label = typeof o === 'string' ? o : o.label;
    const value = typeof o === 'string' ? o : o.value;
    const on = multi ? selected.includes(value) : selected === value;
    return `<button type="button" class="chip${on ? ' on' : ''}" data-value="${esc(value)}">${esc(label)}</button>`;
  }).join('')}</div>`;
}

function isOpen(g) {
  const dl = toDate(g.deadline);
  return !g.closed && (!dl || dl > new Date());
}

function showError(e) {
  console.error(e);
  const box = document.getElementById('err');
  if (box) { box.textContent = '連不上資料庫，請稍後再試。（' + (e.code || e.message || e) + '）'; box.hidden = false; }
}

// ---------- 畫面 1：首頁 ----------
function renderHome() {
  $app.innerHTML = `
    <h1>今天訂飲料</h1>
    <p id="err" class="err" hidden></p>
    <div id="list"><p class="muted">載入中…</p></div>
    <a class="btn primary" href="#/new">我要開團</a>`;
  const since = Timestamp.fromDate(new Date(Date.now() - 24 * 3600 * 1000));
  unsubs.push(onSnapshot(query(collection(db, 'groups'), where('createdAt', '>', since)), (snap) => {
    const groups = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
    const list = document.getElementById('list');
    if (!list) return;
    if (!groups.length) { list.innerHTML = '<p class="muted">現在沒有人開團。</p>'; return; }
    list.innerHTML = groups.map((g) => {
      const dl = toDate(g.deadline);
      const open = isOpen(g);
      return `<a class="card" href="#/g/${g.id}">
        <div class="title">${esc(g.storeName)} ${open ? '' : '<span class="tag">已截止</span>'}</div>
        <div class="muted">${esc(g.leader)}開團${dl ? ' · ' + hhmm(dl) + ' 截止' : ''}</div></a>`;
    }).join('');
  }, showError));
}

// ---------- 畫面 2：開團 ----------
function renderNew() {
  const me = mem.get('me');
  const s = { leader: TEACHERS.includes(me) ? me : '', storeId: STORES[0].id };
  let def = new Date(Date.now() + 60 * 60 * 1000);
  if (def.getDate() !== new Date().getDate()) { def = new Date(); def.setHours(23, 59, 0, 0); }
  $app.innerHTML = `
    <a class="back" href="#/">‹ 回首頁</a>
    <h1>開團</h1>
    <p id="err" class="err" hidden></p>
    <h2>你是誰</h2>${chips('leader', TEACHERS, s.leader)}
    <h2>選店家</h2>${chips('store', STORES.map((x) => ({ label: x.name, value: x.id })), s.storeId)}
    <h2>今天幾點截止</h2><input id="deadline" type="time" value="${hhmm(def)}">
    <h2>你的郵局帳號</h2>
    <input id="account" inputmode="numeric" placeholder="0001234-0567890" maxlength="40">
    <p class="muted small">存過一次，下次開團會自動帶出。大家點完會看到這個帳號。</p>
    <p id="msg" class="err" hidden></p>
    <button id="go" class="btn primary">開團</button>`;

  const acc = document.getElementById('account');
  const loadAccount = async () => {
    if (!s.leader) return;
    try {
      const d = await getDoc(doc(db, 'people', s.leader));
      acc.value = d.exists() ? d.data().account || '' : '';
    } catch (e) { showError(e); }
  };
  loadAccount();

  $app.querySelectorAll('.chips').forEach((box) => box.addEventListener('click', (ev) => {
    const b = ev.target.closest('.chip'); if (!b) return;
    box.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
    if (box.dataset.group === 'leader') { s.leader = b.dataset.value; loadAccount(); }
    else s.storeId = b.dataset.value;
  }));

  document.getElementById('go').addEventListener('click', async (ev) => {
    const msg = document.getElementById('msg');
    const t = document.getElementById('deadline').value;
    const account = acc.value.trim();
    const problem = !s.leader ? '先選你是誰' : !t ? '先選截止時間' : !account ? '先填郵局帳號' : '';
    if (problem) { msg.textContent = problem; msg.hidden = false; return; }
    msg.hidden = true;
    const [h, m] = t.split(':').map(Number);
    const dl = new Date(); dl.setHours(h, m, 0, 0);
    if (dl <= new Date()) { msg.textContent = '這個時間已經過了，請選晚一點'; msg.hidden = false; return; }
    ev.target.disabled = true;
    try {
      await setDoc(doc(db, 'people', s.leader), { account });
      const ref = await addDoc(collection(db, 'groups'), {
        storeId: s.storeId, storeName: store(s.storeId).name, leader: s.leader, account,
        deadline: Timestamp.fromDate(dl), createdAt: serverTimestamp(), closed: false,
      });
      mem.set('me', s.leader);
      location.hash = `#/g/${ref.id}/sum?new=1`;
    } catch (e) { ev.target.disabled = false; showError(e); }
  });
}

// ---------- 畫面 3：點飲料 ----------
function renderOrder(gid) {
  $app.innerHTML = '<p class="muted">載入中…</p>';
  const me = mem.get('me');
  const f = { name: TEACHERS.includes(me) ? me : '', item: '', size: '', sugar: '', ice: '', toppings: [], note: '', pay: '轉帳' };
  let g = null; let orders = []; let done = null; let built = false;

  const price = (st) => {
    const it = st.items.find((i) => i.n === f.item);
    if (!it || !f.size) return 0;
    return it.p[f.size] + f.toppings.reduce((sum, n) => sum + (st.toppings.find((t) => t.n === n)?.p || 0), 0);
  };

  const build = () => {
    const st = store(g.storeId);
    const dl = toDate(g.deadline);
    const last = mem.get('last.' + g.storeId);
    const open = isOpen(g);
    $app.innerHTML = `
      <a class="back" href="#/">‹ 回首頁</a>
      <h1>${esc(g.storeName)}</h1>
      <p class="muted">${esc(g.leader)}開團${dl ? ' · ' + hhmm(dl) + ' 截止' : ''} · <a href="#/g/${gid}/sum">看彙整</a></p>
      <p id="err" class="err" hidden></p>
      <div id="done"></div>
      ${open ? `<div id="form">
        <h2>你是誰</h2>${chips('name', TEACHERS, f.name)}
        ${last ? `<button id="same" class="btn">跟上次一樣：${esc(desc(last))}</button>` : ''}
        <h2>飲料</h2>${chips('item', st.items.map((i) => ({ label: `${i.n} ${Object.values(i.p).join('/')}`, value: i.n })), f.item)}
        <h2>大小</h2>${chips('size', st.sizes, f.size)}
        <h2>甜度</h2>${chips('sugar', st.sugar, f.sugar)}
        <h2>冰塊</h2>${chips('ice', st.ice, f.ice)}
        <h2>加料（可以不選）</h2>${chips('toppings', st.toppings.map((t) => ({ label: `+${t.n} ${t.p}`, value: t.n })), f.toppings, true)}
        <h2>備註（可以不填）</h2><input id="note" maxlength="60" placeholder="例：分兩杯裝">
        <h2>怎麼付錢</h2>${chips('pay', ['轉帳', '現金'], f.pay)}
        <p id="msg" class="err" hidden></p>
        <button id="send" class="btn primary">送出 · <span id="price">0</span> 元</button>
      </div>` : '<p class="notice">已經截止了，不能再點。</p>'}
      <h2>大家點了</h2><div id="orders"></div>`;
    built = true;

    const refresh = () => {
      $app.querySelectorAll('.chips').forEach((box) => {
        const k = box.dataset.group;
        box.querySelectorAll('.chip').forEach((c) => {
          c.classList.toggle('on', k === 'toppings' ? f.toppings.includes(c.dataset.value) : f[k] === c.dataset.value);
        });
      });
      const p = document.getElementById('price'); if (p) p.textContent = price(st);
      const note = document.getElementById('note'); if (note && note.value !== f.note) note.value = f.note;
    };

    $app.querySelectorAll('.chips').forEach((box) => box.addEventListener('click', (ev) => {
      const b = ev.target.closest('.chip'); if (!b) return;
      const k = box.dataset.group; const v = b.dataset.value;
      const msg = document.getElementById('msg'); if (msg) msg.hidden = true;
      if (k === 'toppings') f.toppings = f.toppings.includes(v) ? f.toppings.filter((x) => x !== v) : [...f.toppings, v];
      else f[k] = v;
      if (k === 'name') { f.pay = '轉帳'; renderOrders(); }
      refresh();
    }));
    document.getElementById('note')?.addEventListener('input', (e) => { f.note = e.target.value; });
    document.getElementById('same')?.addEventListener('click', () => {
      Object.assign(f, { item: last.item, size: last.size, sugar: last.sugar, ice: last.ice, toppings: [...(last.toppings || [])], note: last.note || '', pay: last.pay || '轉帳' });
      refresh();
      document.getElementById('send').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    document.getElementById('send')?.addEventListener('click', async (ev) => {
      const msg = document.getElementById('msg');
      const problem = !f.name ? '先選你是誰' : !f.item ? '先選飲料' : !f.size ? '先選大小' : !f.sugar ? '先選甜度' : !f.ice ? '先選冰塊' : '';
      if (problem) { msg.textContent = problem; msg.hidden = false; return; }
      msg.hidden = true;
      const o = { name: f.name, item: f.item, size: f.size, sugar: f.sugar, ice: f.ice, toppings: f.toppings, note: f.note.trim(), price: price(st), pay: f.pay };
      ev.target.disabled = true;
      try {
        await addDoc(collection(db, 'groups', gid, 'orders'), { ...o, paid: false, createdAt: serverTimestamp() });
        mem.set('me', f.name);
        mem.set('last.' + g.storeId, o);
        done = o;
        Object.assign(f, { item: '', size: '', sugar: '', ice: '', toppings: [], note: '' });
        refresh();
        renderDone();
      } catch (e) { showError(e); } finally { ev.target.disabled = false; }
    });
    refresh();
    renderOrders();
    renderDone();
  };

  const renderDone = () => {
    const box = document.getElementById('done'); if (!box) return;
    if (!done) { box.innerHTML = ''; document.getElementById('form')?.removeAttribute('hidden'); return; }
    const mine = orders.filter((o) => o.name === done.name);
    const total = mine.reduce((s, o) => s + o.price, 0) || done.price;
    box.innerHTML = `<div class="paybox">
      <div>點好了！${esc(done.name)}一共要付</div>
      <div class="big">${total} 元</div>
      <div>給 ${esc(g.leader)}${done.pay === '現金' ? '（現金）' : ''}</div>
      ${done.pay === '轉帳' ? `<div class="acct">郵局 <b>${esc(g.account)}</b></div>
        <button id="copyAcc" class="btn">複製帳號</button>` : ''}
      <button id="more" class="btn">再點一杯</button></div>`;
    document.getElementById('form')?.setAttribute('hidden', '');
    document.getElementById('copyAcc')?.addEventListener('click', (e) => copy(g.account.replace(/\D/g, ''), e.target));
    document.getElementById('more').addEventListener('click', () => { done = null; build(); });
  };

  const renderOrders = () => {
    const box = document.getElementById('orders'); if (!box) return;
    if (!orders.length) { box.innerHTML = '<p class="muted">還沒有人點。</p>'; return; }
    box.innerHTML = orders.map((o) => `<div class="row">
      <span><b>${esc(o.name)}</b> ${esc(desc(o))}</span>
      <span>${o.price} 元${o.name === f.name && isOpen(g) ? ` <button class="link del" data-id="${o.id}">刪掉</button>` : ''}</span></div>`).join('');
    box.querySelectorAll('.del').forEach((b) => b.addEventListener('click', async () => {
      try { await deleteDoc(doc(db, 'groups', gid, 'orders', b.dataset.id)); } catch (e) { showError(e); }
    }));
  };

  unsubs.push(onSnapshot(doc(db, 'groups', gid), (d) => {
    if (!d.exists()) { $app.innerHTML = '<a class="back" href="#/">‹ 回首頁</a><p>找不到這一團。</p>'; return; }
    const wasOpen = g && isOpen(g);
    g = { id: d.id, ...d.data() };
    if (!built || wasOpen !== isOpen(g)) build();
  }, showError));
  unsubs.push(onSnapshot(collection(db, 'groups', gid, 'orders'), (snap) => {
    orders = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (toDate(a.createdAt) || new Date()) - (toDate(b.createdAt) || new Date()));
    renderOrders();
    if (done) renderDone();
  }, showError));
}

function desc(o) {
  const parts = [o.item, o.size + '杯', o.sugar, o.ice];
  if (o.toppings && o.toppings.length) parts.push('+' + o.toppings.join('+'));
  if (o.note) parts.push('（' + o.note + '）');
  return parts.join(' ');
}

// ---------- 畫面 4：彙整（團主） ----------
function renderSummary(gid, isNew) {
  $app.innerHTML = '<p class="muted">載入中…</p>';
  let g = null; let orders = [];

  const draw = () => {
    if (!g) return;
    const dl = toDate(g.deadline);
    const link = `${pageUrl()}#/g/${gid}`;
    const lineText = `${g.storeName} 開團囉！${dl ? hhmm(dl) + ' 截止' : ''}\n要喝的點這裡 👉 ${link}`;

    const merged = {};
    orders.forEach((o) => { const k = desc(o); merged[k] = (merged[k] || 0) + 1; });
    const shopText = Object.entries(merged).map(([k, n]) => `${k} ×${n}`).join('\n');

    const people = {};
    orders.forEach((o) => {
      const p = people[o.name] || (people[o.name] = { name: o.name, total: 0, pay: new Set(), ids: [], paid: true });
      p.total += o.price; p.pay.add(o.pay); p.ids.push(o.id); if (!o.paid) p.paid = false;
    });
    const plist = Object.values(people);
    const total = orders.reduce((s, o) => s + o.price, 0);
    const got = plist.filter((p) => p.paid).reduce((s, p) => s + p.total, 0);

    $app.innerHTML = `
      <a class="back" href="#/g/${gid}">‹ 回點飲料</a>
      <h1>${esc(g.storeName)} 彙整</h1>
      <p class="muted">${esc(g.leader)}開團${dl ? ' · ' + hhmm(dl) + ' 截止' : ''} · ${isOpen(g) ? '點單中' : '已截止'}</p>
      <p id="err" class="err" hidden></p>
      ${isNew ? '<p class="notice">開團成功！先把下面這段話貼到 LINE 群。</p>' : ''}
      <div class="box"><pre>${esc(lineText)}</pre><button id="copyLine" class="btn">複製這段話貼到 LINE</button></div>
      <h2>跟店家這樣說（共 ${orders.length} 杯，${total} 元）</h2>
      ${orders.length ? `<div class="box">${Object.entries(merged).map(([k, n]) => `<div class="row"><span>${esc(k)}</span><b>×${n}</b></div>`).join('')}
        <button id="copyShop" class="btn">複製清單</button></div>` : '<p class="muted">還沒有人點。</p>'}
      <h2>誰要付多少（已收 ${got} / ${total} 元）</h2>
      <p class="muted small">收到錢就打勾。</p>
      <div class="box">${plist.map((p) => `<label class="row check">
        <span><input type="checkbox" data-ids="${p.ids.join(',')}" ${p.paid ? 'checked' : ''}> ${esc(p.name)}</span>
        <span>${p.total} 元 · ${[...p.pay].join('/')}</span></label>`).join('') || '<p class="muted">還沒有人點。</p>'}</div>
      <button id="toggle" class="btn">${g.closed ? '重新開放點單' : '結束點單'}</button>`;

    document.getElementById('copyLine').addEventListener('click', (e) => copy(lineText, e.target));
    document.getElementById('copyShop')?.addEventListener('click', (e) => copy(shopText, e.target));
    $app.querySelectorAll('input[type=checkbox]').forEach((cb) => cb.addEventListener('change', async () => {
      const b = writeBatch(db);
      cb.dataset.ids.split(',').forEach((id) => b.update(doc(db, 'groups', gid, 'orders', id), { paid: cb.checked }));
      try { await b.commit(); } catch (e) { showError(e); }
    }));
    document.getElementById('toggle').addEventListener('click', async () => {
      try { await updateDoc(doc(db, 'groups', gid), { closed: !g.closed }); } catch (e) { showError(e); }
    });
  };

  unsubs.push(onSnapshot(doc(db, 'groups', gid), (d) => {
    if (!d.exists()) { $app.innerHTML = '<a class="back" href="#/">‹ 回首頁</a><p>找不到這一團。</p>'; return; }
    g = { id: d.id, ...d.data() }; draw();
  }, showError));
  unsubs.push(onSnapshot(collection(db, 'groups', gid, 'orders'), (snap) => {
    orders = snap.docs.map((d) => ({ id: d.id, ...d.data() })); draw();
  }, showError));
}

// ---------- 換頁 ----------
function route() {
  stopListening();
  window.scrollTo(0, 0);
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  const m = path.match(/^\/g\/([^/]+)(\/sum)?$/);
  if (path === '/new') renderNew();
  else if (m && m[2]) renderSummary(m[1], /new=1/.test(qs || ''));
  else if (m) renderOrder(m[1]);
  else renderHome();
}
window.addEventListener('hashchange', route);
route();
