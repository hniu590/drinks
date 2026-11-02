import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, collection, doc, addDoc, setDoc, getDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, serverTimestamp, Timestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { TEACHERS, STORES } from './data.js';
import { desc, sizeName, groupLedger, billsFor } from './ledger.js';

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
const CUP = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8h12l-1.4 12.2a1 1 0 0 1-1 .8H8.4a1 1 0 0 1-1-.8L6 8z"/><path d="M5 8h14"/><path d="M12 8 14.5 2.5"/><circle cx="10" cy="17" r=".6" fill="currentColor"/><circle cx="13" cy="18" r=".6" fill="currentColor"/><circle cx="12" cy="15.5" r=".6" fill="currentColor"/></svg>';
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const toDate = (t) => (t && t.toDate ? t.toDate() : null);
const dayDiff = (d) => { const a = new Date(d); a.setHours(0, 0, 0, 0); const b = new Date(); b.setHours(0, 0, 0, 0); return Math.round((a - b) / 86400000); };
const mdw = (d) => `${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）`;
// 截止時間怎麼寫：今天只寫時間；明天寫「明天 15:00」；其他寫日期
const whenText = (d) => { const n = dayDiff(d); return (n === 0 ? '' : n === 1 ? '明天 ' : mdw(d) + ' ') + hhmm(d); };
// 給 LINE 的：不是今天就把日期寫清楚
const whenLine = (d) => (dayDiff(d) === 0 ? hhmm(d) : (dayDiff(d) === 1 ? '明天 ' : '') + mdw(d) + ' ' + hhmm(d));
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

// ---------- 首頁三區：點飲料／我要付錢／我開的團 ----------
// 首頁的團：截止後 12 小時內；我開的團：截止後 3 天內；我要付錢：截止後 7 天內、團主還沒打勾（老師 11/2 決定）
const HOUR = 3600 * 1000;
const KEEP = { home: 12 * HOUR, mine: 3 * 24 * HOUR, pay: 7 * 24 * HOUR };
const within = (g, ms) => { const dl = toDate(g.deadline); return !dl || dl.getTime() > Date.now() - ms; };
const PAY_NOTE = '請備註自己的名字！謝謝您';

function tabBar(on) {
  const t = [['/', '點飲料'], ['/pay', '我要付錢'], ['/mine', '我開的團']];
  return `<nav class="area">${t.map(([h, n]) => `<a href="#${h}"${h === on ? ' class="on" aria-current="page"' : ''}>${n}</a>`).join('')}</nav>`;
}

// 「我是 ○○（換人）」；還不知道是誰就列名字讓他選
function whoBox(me, onPick) {
  const box = document.getElementById('who');
  if (TEACHERS.includes(me)) {
    box.innerHTML = `<p class="who">我是 <b>${esc(me)}</b> <button class="link" id="chg">換人</button></p>`;
    document.getElementById('chg').addEventListener('click', () => { box.innerHTML = `<h2>你是誰</h2>${chips('who', TEACHERS, me)}`; bind(); });
  } else {
    box.innerHTML = `<h2>你是誰</h2>${chips('who', TEACHERS, '')}`; bind();
  }
  function bind() {
    box.querySelector('.chips').addEventListener('click', (ev) => {
      const b = ev.target.closest('.chip'); if (!b) return;
      mem.set('me', b.dataset.value); onPick(b.dataset.value);
    });
  }
}

// 每個區都要：最近 7 天的團＋每團的點單（即時更新）
function watchGroups(onChange) {
  const groups = {}; const orders = {};
  const since = Timestamp.fromDate(new Date(Date.now() - KEEP.pay));
  unsubs.push(onSnapshot(query(collection(db, 'groups'), where('deadline', '>', since)), (snap) => {
    snap.docs.forEach((d) => {
      if (!groups[d.id]) {
        unsubs.push(onSnapshot(collection(db, 'groups', d.id, 'orders'), (s2) => {
          orders[d.id] = s2.docs.map((x) => ({ id: x.id, ...x.data() })); onChange(groups, orders);
        }, showError));
      }
      groups[d.id] = { id: d.id, ...d.data() };
    });
    Object.keys(groups).forEach((id) => { if (!snap.docs.some((d) => d.id === id)) delete groups[id]; });
    onChange(groups, orders);
  }, showError));
}

// 點單中的在上面、先截止的排前面；已截止的放後面、最近截止的排前面
const byDeadline = (a, b) => (isOpen(b) - isOpen(a)) || ((isOpen(a) ? 1 : -1) * ((toDate(a.deadline) || 0) - (toDate(b.deadline) || 0)));

// ① 點飲料
function renderHome() {
  const now = new Date();
  $app.innerHTML = `${tabBar('/')}
    <h1>今天喝什麼？</h1>
    <p class="muted" id="today">${mdw(now)}</p>
    <p id="err" class="err" hidden></p>
    <div id="list"><p class="muted">載入中…</p></div>
    <a class="btn primary" href="#/new"><span class="plus">＋</span> 我要開團</a>`;
  watchGroups((groups, orders) => {
    // 點單中的在上面、先截止的排前面；已截止的放後面
    const list = document.getElementById('list'); if (!list) return;
    const gs = Object.values(groups).filter((g) => within(g, KEEP.home)).sort(byDeadline);
    document.getElementById('today').textContent = `${mdw(now)} · ${gs.filter(isOpen).length} 團點單中`;
    if (!gs.length) { list.innerHTML = '<div class="empty">現在沒有人開團，當第一個吧！</div>'; return; }
    list.innerHTML = gs.map((g) => {
      const dl = toDate(g.deadline);
      const open = isOpen(g);
      const color = store(g.storeId)?.color || 'amber';
      return `<a class="card store-${color}${open ? '' : ' closed'}" href="#/g/${g.id}">
        <span class="cup">${CUP}</span>
        <span class="info"><span class="title">${esc(g.storeName)}</span>
          <span class="muted">${esc(g.leader)}開團 · 已點 ${orders[g.id] ? orders[g.id].length : '…'} 杯</span></span>
        <span class="when">${open ? `<b>${dl ? whenText(dl) : ''}</b><small>截止</small>` : '<small>已截止</small>'}</span></a>`;
    }).join('');
  });
}

// 告訴團主「我付了」：把這個人在這一團、同一種付法、還沒打勾的杯子都標上
async function tell(gid, ids, kind) {
  const b = writeBatch(db);
  ids.forEach((id) => b.update(doc(db, 'groups', gid, 'orders', id), { told: kind }));
  try { await b.commit(); } catch (e) { showError(e); }
}

// ② 我要付錢（同事）
function renderPay() {
  $app.innerHTML = `${tabBar('/pay')}
    <h1>我要付錢</h1>
    <p id="err" class="err" hidden></p>
    <div id="who"></div>
    <div id="list"><p class="muted">載入中…</p></div>`;
  let me = mem.get('me'); let last = null;
  const draw = () => {
    const list = document.getElementById('list'); if (!list || !last) return;
    if (!TEACHERS.includes(me)) { list.innerHTML = ''; return; }
    const [groups, orders] = last;
    const bills = Object.values(groups).sort(byDeadline).flatMap((g) => billsFor(orders[g.id] || [], me).map((b) => ({ ...b, g })));
    if (!bills.length) { list.innerHTML = '<div class="empty">沒有要付的錢。</div>'; return; }
    list.innerHTML = bills.map((x, i) => {
      const color = store(x.g.storeId)?.color || 'amber';
      const cash = x.pay === '現金';
      return `<div class="bill store-${color}">
        <div class="bill-head"><span class="cup">${CUP}</span><span><b>${esc(x.g.storeName)}</b>
          <span class="muted"> · ${mdw(toDate(x.g.deadline) || new Date())}</span></span></div>
        <ul class="cups">${x.cups.map((c) => `<li><span>${esc(c.text)}</span><span>${c.price}</span></li>`).join('')}</ul>
        <div class="bill-amt">${x.total} 元 <small>給 ${esc(x.g.leader)}${cash ? '（現金）' : ''}</small></div>
        ${x.told ? `<p class="ok-line">已告訴${esc(x.g.leader)}${cash ? '給現金了' : '匯好了'}，等團主確認 <button class="link undo" data-i="${i}">按錯了</button></p>`
        : `${cash ? '' : `<div class="acct">郵局 <b>${esc(x.g.account)}</b> <button class="link cp" data-i="${i}">複製帳號</button></div>
          <p class="note">${PAY_NOTE}</p>`}
          <button class="btn primary tell" data-i="${i}">${cash ? '我給現金了' : '我匯好了'}</button>`}
      </div>`;
    }).join('');
    list.querySelectorAll('.cp').forEach((b) => b.addEventListener('click', () => copy(bills[b.dataset.i].g.account.replace(/\D/g, ''), b)));
    list.querySelectorAll('.tell').forEach((b) => b.addEventListener('click', () => { const x = bills[b.dataset.i]; b.disabled = true; tell(x.g.id, x.ids, x.pay === '現金' ? '現金' : '匯款'); }));
    list.querySelectorAll('.undo').forEach((b) => b.addEventListener('click', () => { const x = bills[b.dataset.i]; tell(x.g.id, x.ids, ''); }));
  };
  const pick = (name) => { me = name; whoBox(me, pick); draw(); };
  whoBox(me, pick);
  watchGroups((groups, orders) => { last = [groups, orders]; draw(); });
}

// 帳本的狀態 → 小標籤的顏色
const stClass = (status) => (status === '收到' ? 'st-ok' : status === '還沒付' ? 'st-no' : 'st-told');

// ③ 我開的團（團主）
function renderMine() {
  $app.innerHTML = `${tabBar('/mine')}
    <h1>我開的團</h1>
    <p id="err" class="err" hidden></p>
    <div id="who"></div>
    <div id="list"><p class="muted">載入中…</p></div>`;
  let me = mem.get('me'); let last = null;
  const draw = () => {
    const list = document.getElementById('list'); if (!list || !last) return;
    if (!TEACHERS.includes(me)) { list.innerHTML = ''; return; }
    const [groups, orders] = last;
    const gs = Object.values(groups).filter((g) => g.leader === me && within(g, KEEP.mine)).sort(byDeadline);
    if (!gs.length) { list.innerHTML = '<div class="empty">最近 3 天沒有開團。</div><a class="btn primary" href="#/new"><span class="plus">＋</span> 我要開團</a>'; return; }
    list.innerHTML = gs.map((g) => {
      const L = groupLedger(orders[g.id] || []);
      const told = L.people.filter((p) => stClass(p.status) === 'st-told').length;
      const dl = toDate(g.deadline);
      return `<div class="bill store-${store(g.storeId)?.color || 'amber'}">
        <div class="bill-head"><span class="cup">${CUP}</span><span><b>${esc(g.storeName)}</b>
          <span class="muted"> · ${isOpen(g) ? (dl ? whenText(dl) + ' 截止' : '點單中') : (dl ? mdw(dl) + ' ' : '') + '已截止'}</span><br>
          <span class="muted">${L.cups} 杯 · 已收 ${L.got} / ${L.total} 元${told ? ` · <span class="st-told">${told} 人說已付</span>` : ''}</span></span></div>
        <a class="btn primary" href="#/g/${g.id}/sum">看彙整、對帳</a></div>`;
    }).join('');
  };
  const pick = (name) => { me = name; whoBox(me, pick); draw(); };
  whoBox(me, pick);
  watchGroups((groups, orders) => { last = [groups, orders]; draw(); });
}

// ---------- 畫面 2：開團 ----------
function renderNew() {
  const me = mem.get('me');
  const s = { leader: TEACHERS.includes(me) ? me : '', storeId: STORES[0].id, day: '0' };
  let def = new Date(Date.now() + 60 * 60 * 1000);
  // 太晚了（今天剩不到一小時）就預設明天下午 3 點
  if (def.getDate() !== new Date().getDate()) { s.day = '1'; def = new Date(); def.setHours(15, 0, 0, 0); }
  $app.innerHTML = `
    <a class="back" href="#/">‹ 回首頁</a>
    <h1>開團</h1>
    <p id="err" class="err" hidden></p>
    <h2>你是誰</h2>${chips('leader', TEACHERS, s.leader)}
    <h2>選店家</h2>${chips('store', STORES.map((x) => ({ label: x.name, value: x.id })), s.storeId)}
    <h2>哪天截止</h2>${chips('day', [{ label: '今天 ' + mdw(new Date()), value: '0' }, { label: '明天 ' + mdw(new Date(Date.now() + 86400000)), value: '1' }], s.day)}
    <h2>幾點截止</h2><input id="deadline" type="time" value="${hhmm(def)}">
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
    else if (box.dataset.group === 'day') s.day = b.dataset.value;
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
    const dl = new Date(); dl.setDate(dl.getDate() + Number(s.day)); dl.setHours(h, m, 0, 0);
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
  const f = { cat: '', name: TEACHERS.includes(me) ? me : '', item: '', size: '', sugar: '', ice: '', toppings: [], note: '', pay: '轉帳' };
  let g = null; let orders = []; let done = null; let built = false;

  const price = (st) => {
    const it = st.items.find((i) => i.n === f.item);
    if (!it || !f.size) return 0;
    return it.p[f.size] + f.toppings.reduce((sum, n) => sum + (st.toppings.find((t) => t.n === n)?.p || 0), 0);
  };

  const build = () => {
    const st = store(g.storeId);
    if (!st) { $app.innerHTML = '<a class="back" href="#/">‹ 回首頁</a><p class="notice">這一團的店家已經不在菜單裡了。</p>'; return; }
    const dl = toDate(g.deadline);
    const open = isOpen(g);
    const cats = [...new Set(st.items.map((i) => i.c || '飲料'))];
    if (!cats.includes(f.cat)) f.cat = (st.items.find((i) => i.n === f.item)?.c) || cats[0];
    $app.innerHTML = `
      <a class="back" href="#/">‹ 回首頁</a>
      <div class="store-head store-${st.color || 'amber'}"><span class="cup">${CUP}</span>
        <span><h1>${esc(g.storeName)}</h1>
        <span class="muted">${esc(g.leader)}開團${dl ? ' · ' + whenText(dl) + ' 截止' : ''}</span></span></div>
      <p id="err" class="err" hidden></p>
      ${!open || mem.get('me') === g.leader ? `<a class="btn soft sumbtn" href="#/g/${gid}/sum">看彙整、對帳（團主）</a>` : ''}
      <div id="done"></div>
      ${open ? `<div id="form">
        <h2>你是誰</h2>${chips('name', TEACHERS, f.name)}
        <h2>飲料</h2>
        <div class="tabs">${cats.map((c) => `<button type="button" class="tab${c === f.cat ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
        <div id="menu"></div>
        <h2>大小</h2>${chips('size', st.sizes.map((z) => ({ label: sizeName(z), value: z })), f.size)}
        <h2>甜度</h2>${chips('sugar', st.sugar, f.sugar)}
        <h2>冰塊</h2>${chips('ice', st.ice, f.ice)}
        ${st.toppings.length ? `<h2>加料（可以不選）</h2>${chips('toppings', st.toppings.map((t) => ({ label: `+${t.n} ${t.p}`, value: t.n })), f.toppings, true)}` : ''}
        <h2>備註（可以不填）</h2><input id="note" maxlength="60" placeholder="例：分兩杯裝">
        <h2>怎麼付錢</h2>${chips('pay', ['轉帳', '現金'], f.pay)}
        <p id="msg" class="err" hidden></p>
        <button id="send" class="btn primary">送出 · <span id="price">0</span> 元</button>
      </div>` : '<p class="notice">已經截止了，不能再點。</p>'}
      <h2>大家點了</h2><div id="orders"></div>
      ${open && mem.get('me') !== g.leader ? `<a class="btn soft sumbtn" href="#/g/${gid}/sum">看彙整、對帳（團主）</a>` : ''}`;
    built = true;

    const refresh = () => {
      $app.querySelectorAll('.chips').forEach((box) => {
        const k = box.dataset.group;
        box.querySelectorAll('.chip').forEach((c) => {
          c.classList.toggle('on', k === 'toppings' ? f.toppings.includes(c.dataset.value) : f[k] === c.dataset.value);
        });
      });
      const menu = document.getElementById('menu');
      if (menu) {
        menu.innerHTML = st.items.filter((i) => (i.c || '飲料') === f.cat).map((i) => `<button type="button" class="item${i.n === f.item ? ' on' : ''}" data-item="${esc(i.n)}">
          <span>${esc(i.n)}</span><span class="muted">${st.sizes.filter((z) => i.p[z] != null).map((z) => sizeName(z) + ' ' + i.p[z]).join(' / ')}</span></button>`).join('');
      }
      $app.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.cat === f.cat));
      const it = st.items.find((i) => i.n === f.item);
      $app.querySelectorAll('.chips[data-group=size] .chip').forEach((c) => {
        const z = c.dataset.value; const has = !it || it.p[z] != null;
        c.hidden = !has; c.textContent = it && has ? `${sizeName(z)} ${it.p[z]}` : sizeName(z);
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
    $app.querySelector('.tabs')?.addEventListener('click', (ev) => {
      const t = ev.target.closest('.tab'); if (!t) return; f.cat = t.dataset.cat; refresh();
    });
    document.getElementById('menu')?.addEventListener('click', (ev) => {
      const b = ev.target.closest('.item'); if (!b) return;
      f.item = b.dataset.item;
      const picked = st.items.find((i) => i.n === f.item);
      const sz = st.sizes.filter((z) => picked.p[z] != null);
      if (!sz.includes(f.size)) f.size = sz.length === 1 ? sz[0] : '';
      const msg = document.getElementById('msg'); if (msg) msg.hidden = true;
      refresh();
    });
    document.getElementById('note')?.addEventListener('input', (e) => { f.note = e.target.value; });
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
    const bill = billsFor(orders, done.name).find((b) => b.pay === done.pay);
    const total = bill ? bill.total : done.price;
    const cash = done.pay === '現金';
    const told = bill && bill.told;
    box.innerHTML = `<div class="paybox">
      <div>點好了！${esc(done.name)}${cash ? '用現金' : ''}一共要付</div>
      <div class="big">${total} 元</div>
      <div>給 ${esc(g.leader)}${cash ? '（現金）' : ''}</div>
      ${cash ? '' : `<div class="acct">郵局 <b>${esc(g.account)}</b></div>
        <div class="note">${PAY_NOTE}</div>
        <button id="copyAcc" class="btn">複製帳號</button>`}
      ${told ? `<div class="acct">已告訴團主${cash ? '給現金了' : '匯好了'}</div>`
        : `<button id="tellNow" class="btn">${cash ? '我給現金了' : '我匯好了'}</button>
        <div class="small">晚點再付也可以，到首頁「我要付錢」找得到。</div>`}
      <button id="more" class="btn">再點一杯</button></div>`;
    document.getElementById('tellNow')?.addEventListener('click', (e) => { e.target.disabled = true; if (bill) tell(gid, bill.ids, cash ? '現金' : '匯款'); });
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

// ---------- 畫面 4：彙整（團主） ----------
function renderSummary(gid, isNew) {
  $app.innerHTML = '<p class="muted">載入中…</p>';
  let g = null; let orders = [];

  const draw = () => {
    if (!g) return;
    const dl = toDate(g.deadline);
    const link = `${pageUrl()}#/g/${gid}`;
    const lineText = `${g.storeName} 開團囉！${dl ? whenLine(dl) + ' 截止' : ''}\n要喝的點這裡 👉 ${link}`;

    const L = groupLedger(orders);
    const shopText = L.shop.map((x) => `${x.text} ×${x.n}`).join('\n');

    $app.innerHTML = `
      <a class="back" href="#/mine">‹ 回我開的團</a>
      <div class="store-head store-${store(g.storeId)?.color || 'amber'}"><span class="cup">${CUP}</span><span><h1>${esc(g.storeName)} 彙整</h1>
      <span class="muted">${esc(g.leader)}開團${dl ? ' · ' + whenText(dl) + ' 截止' : ''} · ${isOpen(g) ? '點單中' : '已截止'}</span></span></div>
      <p id="err" class="err" hidden></p>
      ${isNew ? '<p class="notice">開團成功！先把下面這段話貼到 LINE 群。</p>' : ''}
      <div class="box"><pre>${esc(lineText)}</pre><button id="copyLine" class="btn soft">複製這段話貼到 LINE</button></div>
      <h2>跟店家這樣說（共 ${L.cups} 杯，${L.total} 元）</h2>
      ${L.cups ? `<div class="box">${L.shop.map((x) => `<div class="row"><span>${esc(x.text)}</span><b>×${x.n}</b></div>`).join('')}
        <button id="copyShop" class="btn soft">複製清單</button></div>` : '<p class="muted">還沒有人點。</p>'}
      <h2>誰要付多少（已收 ${L.got} / ${L.total} 元）</h2>
      <p class="muted small">對過郵局帳戶（匯款會備註名字）或拿到現金，就打勾。</p>
      <div class="box">${L.people.map((p) => `<div class="person">
        <label class="row check">
          <span><input type="checkbox" data-ids="${p.ids.join(',')}" ${p.paid ? 'checked' : ''}> ${esc(p.name)}</span>
          <span>${p.total} 元${!p.paid && p.due < p.total ? `（還差 ${p.due}）` : ''} · ${p.pays.join('/')} <span class="st ${stClass(p.status)}">${p.status}</span></span></label>
        <ul class="cups">${p.cups.map((c) => `<li${c.paid && !p.paid ? ' class="done"' : ''}><span>${esc(c.text)}</span><span>${c.price}</span></li>`).join('')}</ul>
      </div>`).join('') || '<p class="muted">還沒有人點。</p>'}</div>
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
  else if (path === '/pay') renderPay();
  else if (path === '/mine') renderMine();
  else if (m && m[2]) renderSummary(m[1], /new=1/.test(qs || ''));
  else if (m) renderOrder(m[1]);
  else renderHome();
}
window.addEventListener('hashchange', route);
route();
