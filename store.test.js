// 資料存取考卷（用測試轉接器 store-memory.js）：node --test store.test.js
// 檢查每個動作做對事，也檢查門鎖（firestore.rules）不准的事會被擋。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as S from './store-memory.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const later = (h) => new Date(Date.now() + h * 3600e3);
const cup = { name: '甲', item: '紅茶', size: '大', sugar: '半糖', ice: '少冰', toppings: [], note: '', price: 40, pay: '轉帳' };
const open = () => S.openGroup({ storeId: '50lan', storeName: '50嵐', leader: '團主', account: '0001234', deadline: later(2) });
const cupsOf = (gid) => S.testing.dump().cups[gid];

beforeEach(() => S.testing.reset());

test('開團會記住團主的帳號', async () => {
  await open();
  assert.equal(await S.getAccount('團主'), '0001234');
  assert.equal(await S.getAccount('沒開過'), '');
});

test('點一杯、說已付、打勾、按錯收回、刪掉', async () => {
  const gid = await open();
  await S.addCup(gid, cup);
  const [c] = cupsOf(gid);
  assert.equal(c.paid, false); assert.equal(typeof c.createdAt, 'number');
  await S.tell(gid, [c.id], '匯款'); assert.equal(cupsOf(gid)[0].told, '匯款');
  await S.tell(gid, [c.id], ''); assert.equal(cupsOf(gid)[0].told, '');
  await S.markPaid(gid, [c.id], true); assert.equal(cupsOf(gid)[0].paid, true);
  await S.removeCup(gid, c.id); assert.equal(cupsOf(gid).length, 0);
});

test('門鎖：結束點單後不能點', async () => {
  const gid = await open();
  await S.setClosed(gid, true);
  await assert.rejects(S.addCup(gid, cup), { code: 'permission-denied' });
  await S.setClosed(gid, false);
  await S.addCup(gid, cup);
});

test('門鎖：說已付只能是匯款／現金／空的；價錢、付法要合理', async () => {
  const gid = await open();
  await S.addCup(gid, cup);
  const [c] = cupsOf(gid);
  await assert.rejects(S.tell(gid, [c.id], '亂寫'), { code: 'permission-denied' });
  await assert.rejects(S.addCup(gid, { ...cup, price: 1.5 }), { code: 'permission-denied' });
  await assert.rejects(S.addCup(gid, { ...cup, pay: 'LINE Pay' }), { code: 'permission-denied' });
  await assert.rejects(S.addCup(gid, { ...cup, name: '' }), { code: 'permission-denied' });
  await assert.rejects(S.openGroup({ storeId: 'x', storeName: 'x', leader: '甲', account: '', deadline: later(1) }), { code: 'permission-denied' });
});

test('最近的團：只給截止時間在指定時間之後的，連點單一起', async () => {
  const gid = await open();
  S.testing.putGroup({ id: 'old', storeId: 'x', storeName: '舊團', leader: '乙', account: '1', deadline: Date.now() - 10 * 24 * 3600e3 });
  await S.addCup(gid, cup);
  let got;
  const stop = S.watchRecent(new Date(Date.now() - 7 * 24 * 3600e3), (gs, os) => { got = { gs, os }; });
  await tick();
  assert.deepEqual(got.gs.map((g) => g.storeName), ['50嵐']);
  assert.ok(got.gs[0].deadline instanceof Date);
  assert.equal(got.os[gid].length, 1);
  stop();
});

test('看一團：有變就通知；找不到給 null', async () => {
  const gid = await open();
  const seen = [];
  const stop = S.watchGroup(gid, (g) => seen.push(g && g.closed), () => {});
  await tick();
  await S.setClosed(gid, true); await tick();
  assert.deepEqual(seen.slice(-1), [true]);
  stop();
  let none = 'x';
  S.watchGroup('不存在', (g) => { none = g; }, () => {}); await tick();
  assert.equal(none, null);
});
