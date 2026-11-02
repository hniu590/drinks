// 資料存取的「測試」轉接器：資料放在記憶體，不連網路。跟 store.js 一模一樣的動作。
// 也照 firestore.rules 檢查能寫哪些欄位，規則不准的這裡也會丟錯，所以測試能抓到「正式版會被門鎖擋」的錯。
// 測試在瀏覽器裡把 store.js 換成這個檔；考卷 store.test.js 直接用它。

const db = { groups: new Map(), cups: new Map(), people: new Map() }; // cups: gid → Map(id → 一杯)
const subs = new Set();
let seq = 0;
const nextId = (p) => p + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);
const notify = () => queueMicrotask(() => subs.forEach((f) => f()));
const listen = (f) => { subs.add(f); queueMicrotask(f); return () => subs.delete(f); };
const denied = (why) => { const e = new Error('門鎖不准：' + why); e.code = 'permission-denied'; throw e; };
const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
const copy = (x) => JSON.parse(JSON.stringify(x));
const asGroup = (g) => ({ ...copy(g), deadline: g.deadline ? new Date(g.deadline) : null });
const cupsList = (gid) => [...(db.cups.get(gid) || new Map()).values()].map(copy);

export function watchRecent(since, onChange) {
  return listen(() => {
    const gs = [...db.groups.values()].filter((g) => g.deadline > since.getTime()).map(asGroup);
    onChange(gs, Object.fromEntries(gs.map((g) => [g.id, cupsList(g.id)])));
  });
}

export function watchGroup(gid, onGroup, onCups) {
  return listen(() => { const g = db.groups.get(gid); onGroup(g ? asGroup(g) : null); onCups(cupsList(gid)); });
}

export async function getAccount(name) { return db.people.get(name) || ''; }

export async function openGroup({ storeId, storeName, leader, account, deadline }) {
  if (!str(account, 40)) denied('帳號');
  if (!(str(storeId, 40) && str(storeName, 40) && str(leader, 20) && deadline instanceof Date)) denied('開團欄位');
  db.people.set(leader, account);
  const id = nextId('g');
  db.groups.set(id, { id, storeId, storeName, leader, account, deadline: deadline.getTime(), createdAt: Date.now(), closed: false });
  db.cups.set(id, new Map());
  notify();
  return id;
}

export async function addCup(gid, c) {
  const g = db.groups.get(gid);
  if (!g || g.closed) denied('團已結束點單');
  if (!(str(c.name, 20) && str(c.item, 40) && str(c.size, 10) && str(c.sugar, 10) && str(c.ice, 10))) denied('點單欄位');
  if (!Array.isArray(c.toppings) || c.toppings.length > 6 || typeof c.note !== 'string' || c.note.length > 60) denied('加料或備註');
  if (!Number.isInteger(c.price) || c.price < 0 || c.price > 1000) denied('價錢');
  if (!['轉帳', '現金'].includes(c.pay)) denied('付錢方式');
  const id = nextId('o');
  const { name, item, size, sugar, ice, toppings, note, price, pay } = c;
  db.cups.get(gid).set(id, { id, name, item, size, sugar, ice, toppings, note, price, pay, paid: false, createdAt: Date.now() });
  notify();
}

export async function removeCup(gid, id) { db.cups.get(gid)?.delete(id); notify(); }

function updateCups(gid, ids, data) {
  const cups = db.cups.get(gid);
  ids.forEach((id) => { if (!cups?.has(id)) denied('找不到這杯'); });
  ids.forEach((id) => Object.assign(cups.get(id), data));
  notify();
}
export async function tell(gid, ids, kind) { if (!['', '匯款', '現金'].includes(kind)) denied('說已付的種類'); updateCups(gid, ids, { told: kind }); }
export async function markPaid(gid, ids, paid) { if (typeof paid !== 'boolean') denied('打勾'); updateCups(gid, ids, { paid }); }
export async function setClosed(gid, closed) {
  if (typeof closed !== 'boolean' || !db.groups.has(gid)) denied('結束點單');
  db.groups.get(gid).closed = closed; notify();
}

/** 只給測試用：清空、直接改資料（例如把截止時間調早）、看裡面有什麼 */
export const testing = {
  reset() { db.groups.clear(); db.cups.clear(); db.people.clear(); notify(); },
  patchGroup(gid, data) { Object.assign(db.groups.get(gid), data); notify(); },
  putGroup(g) { db.groups.set(g.id, { closed: false, createdAt: Date.now(), ...g }); if (!db.cups.has(g.id)) db.cups.set(g.id, new Map()); notify(); },
  putCup(gid, c) { db.cups.get(gid).set(c.id, { paid: false, createdAt: Date.now(), toppings: [], note: '', ...c }); notify(); },
  dump: () => ({ groups: [...db.groups.values()].map(copy), cups: Object.fromEntries([...db.cups].map(([k, v]) => [k, [...v.values()].map(copy)])) }),
};
if (typeof window !== 'undefined') window.__drinksTesting = testing;
