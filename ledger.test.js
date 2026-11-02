// 帳本考卷：在電腦上跑 `node --test ledger.test.js`，全對才上線。
// 名字和金額都是假的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desc, groupLedger, billsFor } from './ledger.js';

let t = 0;
const cup = (name, item, price, more = {}) => {
  const n = ++t;
  return { id: 'o' + n, name, item, size: '大', sugar: '半糖', ice: '少冰', toppings: [], note: '',
    price, pay: '轉帳', paid: false, createdAt: { toMillis: () => n }, ...more };
};

test('一杯飲料怎麼寫：名稱 大小 甜度 冰塊 +加料（備註）；瓶寫成瓶裝', () => {
  assert.equal(desc(cup('甲', '紅茶拿鐵', 75)), '紅茶拿鐵 大杯 半糖 少冰');
  assert.equal(desc(cup('甲', '綠茶', 40, { toppings: ['珍珠', '椰果'], note: '分兩杯' })), '綠茶 大杯 半糖 少冰 +珍珠+椰果 （分兩杯）');
  assert.equal(desc(cup('甲', '烏龍', 30, { size: '瓶' })), '烏龍 瓶裝 半糖 少冰');
});

test('沒人點：0 杯、0 元、沒有人', () => {
  const L = groupLedger([]);
  assert.equal(L.cups, 0); assert.equal(L.total, 0); assert.equal(L.got, 0);
  assert.deepEqual(L.people, []); assert.deepEqual(L.shop, []);
});

test('每個人列出自己點的每一杯，照點的先後', () => {
  const L = groupLedger([cup('甲', '紅茶', 40), cup('乙', '綠茶', 35), cup('甲', '奶茶', 55)]);
  assert.deepEqual(L.people.map((p) => p.name), ['甲', '乙']);
  const a = L.people[0];
  assert.deepEqual(a.cups.map((c) => c.text), ['紅茶 大杯 半糖 少冰', '奶茶 大杯 半糖 少冰']);
  assert.deepEqual(a.cups.map((c) => c.price), [40, 55]);
  assert.equal(a.total, 95); assert.equal(a.due, 95);
  assert.equal(L.cups, 3); assert.equal(L.total, 130);
});

test('點單順序亂掉時，還是照點的時間排', () => {
  const x = cup('甲', '紅茶', 40); const y = cup('乙', '綠茶', 35);
  assert.deepEqual(groupLedger([y, x]).people.map((p) => p.name), ['甲', '乙']);
});

test('跟店家說：一樣的合併算杯數，照第一次出現的順序', () => {
  const L = groupLedger([cup('甲', '紅茶', 40), cup('乙', '綠茶', 35), cup('丙', '紅茶', 40)]);
  assert.deepEqual(L.shop, [{ text: '紅茶 大杯 半糖 少冰', n: 2 }, { text: '綠茶 大杯 半糖 少冰', n: 1 }]);
});

test('狀態：還沒付／說已匯款／說已給現金／收到', () => {
  const L = groupLedger([
    cup('甲', '紅茶', 40),
    cup('乙', '綠茶', 35, { told: '匯款' }),
    cup('丙', '奶茶', 50, { pay: '現金', told: '現金' }),
    cup('丁', '烏龍', 30, { paid: true, told: '匯款' }),
  ]);
  const st = Object.fromEntries(L.people.map((p) => [p.name, p.status]));
  assert.equal(st.甲, '還沒付'); assert.equal(st.乙, '說已匯款'); assert.equal(st.丙, '說已給現金'); assert.equal(st.丁, '收到');
  assert.equal(L.got, 30);
});

test('兩杯一杯匯款一杯現金都說付了：說已匯款＋給現金', () => {
  const L = groupLedger([cup('甲', '紅茶', 40, { told: '匯款' }), cup('甲', '綠茶', 35, { pay: '現金', told: '現金' })]);
  assert.equal(L.people[0].status, '說已匯款＋給現金');
  assert.deepEqual(L.people[0].pays, ['轉帳', '現金']);
});

test('只說了一杯、另一杯還沒說：算還沒付', () => {
  const L = groupLedger([cup('甲', '紅茶', 40, { told: '匯款' }), cup('甲', '綠茶', 35)]);
  assert.equal(L.people[0].status, '還沒付');
});

test('按錯了收回（told 是空的）：算還沒付', () => {
  assert.equal(groupLedger([cup('甲', '紅茶', 40, { told: '' })]).people[0].status, '還沒付');
});

test('打勾後又點一杯（11/2 出錯的情況）：已收照杯算、還差只算新的那杯', () => {
  const L = groupLedger([cup('甲', '紅茶', 80, { paid: true }), cup('甲', '檸檬綠', 60)]);
  const a = L.people[0];
  assert.equal(a.total, 140); assert.equal(a.due, 60); assert.equal(a.paid, false);
  assert.equal(a.status, '還沒付');
  assert.equal(L.got, 80);
  assert.deepEqual(a.cups.map((c) => c.paid), [true, false]);
});

test('打勾要改的杯子：還沒收的（打勾）或全部（取消打勾）', () => {
  const L = groupLedger([cup('甲', '紅茶', 80, { paid: true }), cup('甲', '檸檬綠', 60)]);
  const a = L.people[0];
  assert.equal(a.ids.length, 2);
  assert.deepEqual(a.unpaidIds, [a.cups[1].id]);
});

test('我要付錢：只列自己、還沒打勾的，轉帳和現金分開', () => {
  const os = [cup('甲', '紅茶', 40), cup('甲', '綠茶', 35, { pay: '現金' }), cup('甲', '奶茶', 55, { paid: true }), cup('乙', '烏龍', 30)];
  const b = billsFor(os, '甲');
  assert.deepEqual(b.map((x) => [x.pay, x.total, x.cups.map((c) => c.text)]), [
    ['轉帳', 40, ['紅茶 大杯 半糖 少冰']],
    ['現金', 35, ['綠茶 大杯 半糖 少冰']],
  ]);
  assert.equal(b[0].told, ''); assert.deepEqual(b[0].ids, [os[0].id]);
});

test('我要付錢：全部說付了才顯示「已告訴團主」，並記得是哪一種', () => {
  const os = [cup('甲', '紅茶', 40, { told: '匯款' }), cup('甲', '綠茶', 35, { told: '匯款' })];
  const b = billsFor(os, '甲');
  assert.equal(b.length, 1); assert.equal(b[0].total, 75); assert.equal(b[0].told, '匯款');
  assert.equal(billsFor([cup('甲', '紅茶', 40, { told: '匯款' }), cup('甲', '綠茶', 35)], '甲')[0].told, '');
});

test('舊點單沒有 pay 欄位：當作轉帳', () => {
  const o = cup('甲', '紅茶', 40); delete o.pay;
  assert.equal(billsFor([o], '甲')[0].pay, '轉帳');
  assert.deepEqual(groupLedger([o]).people[0].pays, ['轉帳']);
});

test('沒點的人：沒有帳單', () => {
  assert.deepEqual(billsFor([cup('乙', '紅茶', 40)], '甲'), []);
});

test('點的時間是毫秒數（資料存取給的）也照先後排', () => {
  const x = { ...cup('甲', '紅茶', 40), createdAt: 200 }; const y = { ...cup('乙', '綠茶', 35), createdAt: 100 };
  assert.deepEqual(groupLedger([x, y]).people.map((p) => p.name), ['乙', '甲']);
});
