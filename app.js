// 畫面：只負責排版和按鈕。
// 讀寫資料 → store.js（資料存取）；算錢 → ledger.js（帳本）；時間 → deadline.js（截止時間）；
// 首頁「怎麼用？」的步驟 → howto.js。
import * as store from './store.js';
import { TEACHERS, STORES } from './data.js';
import { desc, sizeName, groupLedger, billsFor } from './ledger.js';
import { KEEP, isOpen, shows, whenText, whenLine, mdw, byDeadline, defaultDeadline, makeDeadline } from './deadline.js';
import { HOWTO } from './howto.js';

const $app = document.getElementById('app');
let stops = [];
const keep = (stop) => stops.push(stop);
const stopListening = () => { stops.forEach((s) => s()); stops = []; };

// ---------- 小工具 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shop = (id) => STORES.find((s) => s.id === id);
const colorOf = (g) => shop(g.storeId)?.color || 'amber';
const CUP = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8h12l-1.4 12.2a1 1 0 0 1-1 .8H8.4a1 1 0 0 1-1-.8L6 8z"/><path d="M5 8h14"/><path d="M12 8 14.5 2.5"/><circle cx="10" cy="17" r=".6" fill="currentColor"/><circle cx="13" cy="18" r=".6" fill="currentColor"/><circle cx="12" cy="15.5" r=".6" fill="currentColor"/></svg>';
const pageUrl = () => location.href.split('#')[0];
const PAY_NOTE = '請備註自己的名字！謝謝您';
const PAY_HINT = '選好付錢方式再送出。用匯款的話，請在備註寫上自己的名字，團主比較好對帳喔！';
const NAME_MAX = 10;

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

function showError(e) {
  console.error(e);
  const box = document.getElementById('err');
  if (box) { box.textContent = '連不上資料庫，請稍後再試。（' + (e.code || e.message || e) + '）'; box.hidden = false; }
}
const tryIt = (p) => Promise.resolve(p).catch(showError);

// 帳本的狀態 → 小標籤的顏色
const stClass = (status) => (status === '收到' ? 'st-ok' : status === '還沒付' ? 'st-no' : 'st-told');

// ---------- 首頁三區：點飲料／我要付錢／我開的團 ----------
function tabBar(on) {
  const t = [['/', '點飲料'], ['/pay', '我要付錢'], ['/mine', '我開的團']];
  return `<nav class="area">${t.map(([h, n]) => `<a href="#${h}"${h === on ? ' class="on" aria-current="page"' : ''}>${n}</a>`).join('')}</nav>`;
}

// 「我是 ○○（換人）」；還不知道是誰就列名字讓他選。用「＋」加過的臨時名字手機也記得（11/2）。
function whoBox(me, onPick) {
  const box = document.getElementById('who');
  if (me) {
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
function watchRecent(onChange) {
  keep(store.watchRecent(new Date(Date.now() - KEEP.pay), onChange, showError));
}

function howtoPanel() {
  return `<details class="howto"><summary>怎麼用？</summary><div class="howto-cols">${HOWTO.map((f) => `
    <section class="flow ${f.who}"><h3>${esc(f.title)}</h3><ol>${f.steps.map((s, i) => `
      <li><span class="n" aria-hidden="true">${i + 1}</span><span><b>${esc(s.t)}</b>${s.s ? `<small>${esc(s.s)}</small>` : ''}</span></li>`).join('')}
    </ol></section>`).join('')}</div></details>`;
}

// ① 點飲料
function renderHome() {
  const now = new Date();
  $app.innerHTML = `${tabBar('/')}
    <div class="home-head"><h1>今天喝什麼？</h1></div>
    <p class="muted" id="today">${mdw(now)}</p>
    ${howtoPanel()}
    <p id="err" class="err" hidden></p>
    <div id="list"><p class="muted">載入中…</p></div>
    <a class="btn primary" href="#/new"><span class="plus">＋</span> 我要開團</a>`;
  watchRecent((groups, orders) => {
    const list = document.getElementById('list'); if (!list) return;
    const t = new Date();
    const gs = groups.filter((g) => shows(g, 'home', t)).sort(byDeadline(t));
    document.getElementById('today').textContent = `${mdw(t)} · ${gs.filter((g) => isOpen(g, t)).length} 團點單中`;
    if (!gs.length) { list.innerHTML = '<div class="empty">現在沒有人開團，當第一個吧！</div>'; return; }
    list.innerHTML = gs.map((g) => {
      const open = isOpen(g, t);
      return `<a class="card store-${colorOf(g)}${open ? '' : ' closed'}" href="#/g/${g.id}">
        <span class="cup">${CUP}</span>
        <span class="info"><span class="title">${esc(g.storeName)}</span>
          <span class="muted">${esc(g.leader)}開團 · 已點 ${orders[g.id] ? orders[g.id].length : '…'} 杯</span></span>
        <span class="when">${open ? `<b>${g.deadline ? whenText(g.deadline, t) : ''}</b><small>截止</small>` : '<small>已截止</small>'}</span></a>`;
    }).join('');
  });
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
    if (!me) { list.innerHTML = ''; return; }
    const [groups, orders] = last;
    const t = new Date();
    const bills = groups.filter((g) => shows(g, 'pay', t)).sort(byDeadline(t))
      .flatMap((g) => billsFor(orders[g.id] || [], me).map((b) => ({ ...b, g })));
    if (!bills.length) { list.innerHTML = '<div class="empty">沒有要付的錢。</div>'; return; }
    list.innerHTML = bills.map((x, i) => {
      const cash = x.pay === '現金';
      return `<div class="bill store-${colorOf(x.g)}">
        <div class="bill-head"><span class="cup">${CUP}</span><span><b>${esc(x.g.storeName)}</b>
          <span class="muted"> · ${mdw(x.g.deadline || t)}</span></span></div>
        <ul class="cups">${x.cups.map((c) => `<li><span>${esc(c.text)}</span><span>${c.price}</span></li>`).join('')}</ul>
        <div class="bill-amt">${x.total} 元 <small>給 ${esc(x.g.leader)}${cash ? '（現金）' : ''}</small></div>
        ${x.told ? `<p class="ok-line">已告訴${esc(x.g.leader)}${cash ? '給現金了' : '匯好了'}，等團主確認 <button class="link undo" data-i="${i}">按錯了</button></p>`
        : `${cash ? '' : `<div class="acct">郵局 <b>${esc(x.g.account)}</b> <button class="link cp" data-i="${i}">複製帳號</button></div>
          <p class="note">${PAY_NOTE}</p>`}
          <button class="btn primary tell" data-i="${i}">${cash ? '我給現金了' : '我匯好了'}</button>`}
      </div>`;
    }).join('');
    list.querySelectorAll('.cp').forEach((b) => b.addEventListener('click', () => copy(bills[b.dataset.i].g.account.replace(/\D/g, ''), b)));
    list.querySelectorAll('.tell').forEach((b) => b.addEventListener('click', () => { const x = bills[b.dataset.i]; b.disabled = true; tryIt(store.tell(x.g.id, x.ids, x.pay === '現金' ? '現金' : '匯款')); }));
    list.querySelectorAll('.undo').forEach((b) => b.addEventListener('click', () => { const x = bills[b.dataset.i]; tryIt(store.tell(x.g.id, x.ids, '')); }));
  };
  const pick = (name) => { me = name; whoBox(me, pick); draw(); };
  whoBox(me, pick);
  watchRecent((groups, orders) => { last = [groups, orders]; draw(); });
}

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
    if (!me) { list.innerHTML = ''; return; }
    const [groups, orders] = last;
    const t = new Date();
    const gs = groups.filter((g) => g.leader === me && shows(g, 'mine', t)).sort(byDeadline(t));
    if (!gs.length) { list.innerHTML = '<div class="empty">最近 3 天沒有開團。</div><a class="btn primary" href="#/new"><span class="plus">＋</span> 我要開團</a>'; return; }
    list.innerHTML = gs.map((g) => {
      const L = groupLedger(orders[g.id] || []);
      const told = L.people.filter((p) => stClass(p.status) === 'st-told').length;
      const dl = g.deadline;
      return `<div class="bill store-${colorOf(g)}">
        <div class="bill-head"><span class="cup">${CUP}</span><span><b>${esc(g.storeName)}</b>
          <span class="muted"> · ${isOpen(g, t) ? (dl ? whenText(dl, t) + ' 截止' : '點單中') : (dl ? mdw(dl) + ' ' : '') + '已截止'}</span><br>
          <span class="muted">${L.cups} 杯 · 已收 ${L.got} / ${L.total} 元${told ? ` · <span class="st-told">${told} 人說已付</span>` : ''}</span></span></div>
        <a class="btn primary" href="#/g/${g.id}/sum">看彙整、對帳</a></div>`;
    }).join('');
  };
  const pick = (name) => { me = name; whoBox(me, pick); draw(); };
  whoBox(me, pick);
  watchRecent((groups, orders) => { last = [groups, orders]; draw(); });
}

// ---------- 開團 ----------
function renderNew() {
  const me = mem.get('me');
  const now = new Date();
  const def = defaultDeadline(now);
  const s = { leader: TEACHERS.includes(me) ? me : '', storeId: STORES[0].id, day: String(def.day) };
  $app.innerHTML = `
    <a class="back" href="#/">‹ 回首頁</a>
    <h1>開團</h1>
    <p id="err" class="err" hidden></p>
    <h2>你是誰</h2>${chips('leader', TEACHERS, s.leader)}
    <h2>選店家</h2>${chips('store', STORES.map((x) => ({ label: x.name, value: x.id })), s.storeId)}
    <h2>哪天截止</h2>${chips('day', [{ label: '今天 ' + mdw(now), value: '0' }, { label: '明天 ' + mdw(new Date(now.getTime() + 86400000)), value: '1' }], s.day)}
    <h2>幾點截止</h2><input id="deadline" type="time" value="${def.time}">
    <h2>你的郵局帳號</h2>
    <input id="account" inputmode="numeric" placeholder="0001234-0567890" maxlength="40">
    <p class="muted small">存過一次，下次開團會自動帶出。大家點完會看到這個帳號。</p>
    <p id="msg" class="err" hidden></p>
    <button id="go" class="btn primary">開團</button>`;

  const acc = document.getElementById('account');
  const loadAccount = async () => {
    if (!s.leader) return;
    try { acc.value = await store.getAccount(s.leader); } catch (e) { showError(e); }
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
    const time = document.getElementById('deadline').value;
    const account = acc.value.trim();
    const problem = !s.leader ? '先選你是誰' : !time ? '先選截止時間' : !account ? '先填郵局帳號' : '';
    if (problem) { msg.textContent = problem; msg.hidden = false; return; }
    const deadline = makeDeadline(s.day, time, new Date());
    if (!deadline) { msg.textContent = '這個時間已經過了，請選晚一點'; msg.hidden = false; return; }
    msg.hidden = true;
    ev.target.disabled = true;
    try {
      const id = await store.openGroup({ storeId: s.storeId, storeName: shop(s.storeId).name, leader: s.leader, account, deadline });
      mem.set('me', s.leader);
      location.hash = `#/g/${id}/sum?new=1`;
    } catch (e) { ev.target.disabled = false; showError(e); }
  });
}

// ---------- 點飲料 ----------
function renderOrder(gid) {
  $app.innerHTML = '<p class="muted">載入中…</p>';
  const me = mem.get('me');
  const f = { cat: '', name: me || '', item: '', size: '', sugar: '', ice: '', toppings: [], note: '', pay: '轉帳' };
  let g = null; let orders = []; let done = null; let built = false; let adding = false;

  // 這一團的名單：老師名單＋這團用「＋」加過的人＋這支手機記得的臨時名字（只在這一團有效，11/2）
  const names = () => {
    const extra = [...orders.map((o) => o.name), me, f.name].filter((n) => n && !TEACHERS.includes(n));
    return [...TEACHERS, ...new Set(extra)];
  };

  const price = (st) => {
    const it = st.items.find((i) => i.n === f.item);
    if (!it || !f.size) return 0;
    return it.p[f.size] + f.toppings.reduce((sum, n) => sum + (st.toppings.find((x) => x.n === n)?.p || 0), 0);
  };

  const nameBox = () => `${chips('name', names(), f.name)}
    ${adding ? `<div class="addname"><label for="newname" class="sr-only">你的名字</label>
      <input id="newname" maxlength="${NAME_MAX}" placeholder="你的名字（最多 ${NAME_MAX} 個字）" autocomplete="off">
      <button type="button" id="addok" class="btn soft">加上</button><button type="button" id="addno" class="link">取消</button>
      <p id="addmsg" class="err small" hidden></p></div>`
    : '<button type="button" id="addname" class="chip add" aria-label="名單沒有你？加上你的名字">＋ 名單沒有我</button>'}`;

  const build = () => {
    const st = shop(g.storeId);
    if (!st) { $app.innerHTML = '<a class="back" href="#/">‹ 回首頁</a><p class="notice">這一團的店家已經不在菜單裡了。</p>'; return; }
    const t = new Date();
    const open = isOpen(g, t);
    const cats = [...new Set(st.items.map((i) => i.c || '飲料'))];
    if (!cats.includes(f.cat)) f.cat = (st.items.find((i) => i.n === f.item)?.c) || cats[0];
    $app.innerHTML = `
      <a class="back" href="#/">‹ 回首頁</a>
      <div class="store-head store-${st.color || 'amber'}"><span class="cup">${CUP}</span>
        <span><h1>${esc(g.storeName)}</h1>
        <span class="muted">${esc(g.leader)}開團${g.deadline ? ' · ' + whenText(g.deadline, t) + ' 截止' : ''}</span></span></div>
      <p id="err" class="err" hidden></p>
      ${!open || mem.get('me') === g.leader ? `<a class="btn soft sumbtn" href="#/g/${gid}/sum">看彙整、對帳（團主）</a>` : ''}
      <div id="done"></div>
      ${open ? `<div id="form">
        <h2>你是誰</h2><div id="names">${nameBox()}</div>
        <h2>飲料</h2>
        <div class="tabs">${cats.map((c) => `<button type="button" class="tab${c === f.cat ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
        <div id="menu"></div>
        <h2>大小</h2>${chips('size', st.sizes.map((z) => ({ label: sizeName(z), value: z })), f.size)}
        <h2>甜度</h2>${chips('sugar', st.sugar, f.sugar)}
        <h2>冰塊</h2>${chips('ice', st.ice, f.ice)}
        ${st.toppings.length ? `<h2>加料（可以不選）</h2>${chips('toppings', st.toppings.map((x) => ({ label: `+${x.n} ${x.p}`, value: x.n })), f.toppings, true)}` : ''}
        <h2>備註（可以不填）</h2><input id="note" maxlength="60" placeholder="例：分兩杯裝">
        <h2>怎麼付錢</h2><p class="hint">${PAY_HINT}</p>${chips('pay', ['轉帳', '現金'], f.pay)}
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
      $app.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x.dataset.cat === f.cat));
      const it = st.items.find((i) => i.n === f.item);
      $app.querySelectorAll('.chips[data-group=size] .chip').forEach((c) => {
        const z = c.dataset.value; const has = !it || it.p[z] != null;
        c.hidden = !has; c.textContent = it && has ? `${sizeName(z)} ${it.p[z]}` : sizeName(z);
      });
      // 冰塊：有的飲料不能做熱的（11/3），只顯示那杯可以選的；只有一種就自動選好
      const iceOk = (it && it.ice) || st.ice;
      if (f.ice && !iceOk.includes(f.ice)) f.ice = '';
      if (it && iceOk.length === 1) f.ice = iceOk[0];
      $app.querySelectorAll('.chips[data-group=ice] .chip').forEach((c) => {
        c.hidden = !iceOk.includes(c.dataset.value); c.classList.toggle('on', f.ice === c.dataset.value);
      });
      const p = document.getElementById('price'); if (p) p.textContent = price(st);
      const note = document.getElementById('note'); if (note && note.value !== f.note) note.value = f.note;
    };

    // 名字區：選名字、按「＋」加臨時名字
    const names$ = document.getElementById('names');
    const drawNames = () => { if (!names$) return; names$.innerHTML = nameBox(); bindNames(); };
    const pickName = (n) => { f.name = n; f.pay = '轉帳'; adding = false; drawNames(); refresh(); renderOrders(); };
    function bindNames() {
      names$.querySelector('.chips').addEventListener('click', (ev) => {
        const b = ev.target.closest('.chip'); if (!b) return;
        const msg = document.getElementById('msg'); if (msg) msg.hidden = true;
        pickName(b.dataset.value);
      });
      document.getElementById('addname')?.addEventListener('click', () => { adding = true; drawNames(); document.getElementById('newname').focus(); });
      document.getElementById('addno')?.addEventListener('click', () => { adding = false; drawNames(); });
      const ok = () => {
        const n = document.getElementById('newname').value.trim().replace(/\s+/g, ' ');
        const am = document.getElementById('addmsg');
        if (!n) { am.textContent = '先打你的名字'; am.hidden = false; return; }
        if (n.length > NAME_MAX) { am.textContent = `名字最多 ${NAME_MAX} 個字`; am.hidden = false; return; }
        pickName(n);
      };
      document.getElementById('addok')?.addEventListener('click', ok);
      document.getElementById('newname')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
      document.getElementById('newname')?.addEventListener('input', () => { document.getElementById('addmsg').hidden = true; });
    }
    if (names$) bindNames();

    $app.querySelectorAll('#form > .chips').forEach((box) => box.addEventListener('click', (ev) => {
      const b = ev.target.closest('.chip'); if (!b) return;
      const k = box.dataset.group; const v = b.dataset.value;
      const msg = document.getElementById('msg'); if (msg) msg.hidden = true;
      if (k === 'toppings') f.toppings = f.toppings.includes(v) ? f.toppings.filter((x) => x !== v) : [...f.toppings, v];
      else f[k] = v;
      refresh();
    }));
    $app.querySelector('.tabs')?.addEventListener('click', (ev) => {
      const x = ev.target.closest('.tab'); if (!x) return; f.cat = x.dataset.cat; refresh();
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
        await store.addCup(gid, o);
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
    document.getElementById('tellNow')?.addEventListener('click', (e) => { e.target.disabled = true; if (bill) tryIt(store.tell(gid, bill.ids, cash ? '現金' : '匯款')); });
    document.getElementById('form')?.setAttribute('hidden', '');
    document.getElementById('copyAcc')?.addEventListener('click', (e) => copy(g.account.replace(/\D/g, ''), e.target));
    document.getElementById('more').addEventListener('click', () => { done = null; build(); });
  };

  const renderOrders = () => {
    const box = document.getElementById('orders'); if (!box) return;
    if (!orders.length) { box.innerHTML = '<p class="muted">還沒有人點。</p>'; return; }
    const open = isOpen(g, new Date());
    box.innerHTML = orders.map((o) => `<div class="row">
      <span><b>${esc(o.name)}</b> ${esc(desc(o))}</span>
      <span>${o.price} 元${o.name === f.name && open ? ` <button class="link del" data-id="${o.id}">刪掉</button>` : ''}</span></div>`).join('');
    box.querySelectorAll('.del').forEach((b) => b.addEventListener('click', () => tryIt(store.removeCup(gid, b.dataset.id))));
  };

  keep(store.watchGroup(gid, (x) => {
    if (!x) { $app.innerHTML = '<a class="back" href="#/">‹ 回首頁</a><p>找不到這一團。</p>'; return; }
    const t = new Date();
    const wasOpen = g && isOpen(g, t);
    g = x;
    if (!built || wasOpen !== isOpen(g, t)) build();
  }, (cups) => {
    orders = [...cups].sort((a, b) => (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity));
    renderOrders();
    if (done) renderDone();
    // 這團有人用「＋」加了新名字，名單要多一個
    const names$ = document.getElementById('names');
    if (names$ && !adding && names$.querySelectorAll('.chips .chip').length !== names().length) build();
  }, showError));
}

// ---------- 彙整（團主） ----------
function renderSummary(gid, isNew) {
  $app.innerHTML = '<p class="muted">載入中…</p>';
  let g = null; let orders = [];

  const draw = () => {
    if (!g) return;
    const t = new Date();
    const dl = g.deadline;
    const link = `${pageUrl()}#/g/${gid}`;
    const lineText = `${g.storeName} 開團囉！${dl ? whenLine(dl, t) + ' 截止' : ''}\n要喝的點這裡 👉 ${link}`;
    const L = groupLedger(orders);
    const shopText = L.shop.map((x) => `${x.text} ×${x.n}`).join('\n');

    $app.innerHTML = `
      <a class="back" href="#/mine">‹ 回我開的團</a>
      <div class="store-head store-${colorOf(g)}"><span class="cup">${CUP}</span><span><h1>${esc(g.storeName)} 彙整</h1>
      <span class="muted">${esc(g.leader)}開團${dl ? ' · ' + whenText(dl, t) + ' 截止' : ''} · ${isOpen(g, t) ? '點單中' : '已截止'}</span></span></div>
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
    $app.querySelectorAll('input[type=checkbox]').forEach((cb) => cb.addEventListener('change', () => {
      tryIt(store.markPaid(gid, cb.dataset.ids.split(','), cb.checked));
    }));
    document.getElementById('toggle').addEventListener('click', () => tryIt(store.setClosed(gid, !g.closed)));
  };

  keep(store.watchGroup(gid, (x) => {
    if (!x) { $app.innerHTML = '<a class="back" href="#/">‹ 回首頁</a><p>找不到這一團。</p>'; return; }
    g = x; draw();
  }, (cups) => { orders = cups; draw(); }, showError));
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
