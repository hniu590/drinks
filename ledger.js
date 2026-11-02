// 帳本：給它一團的點單，算出誰點了什麼、該付多少、付了沒。
// 只算、不碰畫面和資料庫；四個畫面（我要付錢、點完的付款框、我開的團、彙整）都跟這裡拿結果。
// 考卷：ledger.test.js（node --test ledger.test.js）。2026/11/2 老師決定。

/** 大小怎麼寫：「瓶」寫成「瓶裝」，其他加「杯」。 */
export const sizeName = (z) => (z === '瓶' ? '瓶裝' : z + '杯');
const payOf = (o) => o.pay || '轉帳';
const when = (o) => (o.createdAt && o.createdAt.toMillis ? o.createdAt.toMillis() : Infinity); // 剛送出還沒有時間的排最後
const byTime = (orders) => [...orders].sort((a, b) => when(a) - when(b));
const sum = (os) => os.reduce((s, o) => s + o.price, 0);

/** 一杯怎麼寫：「紅茶拿鐵 大杯 無糖 少冰 +珍珠 （備註）」。跟店家說的合併也靠這行。 */
export function desc(o) {
  const parts = [o.item, sizeName(o.size), o.sugar, o.ice];
  if (o.toppings && o.toppings.length) parts.push('+' + o.toppings.join('+'));
  if (o.note) parts.push('（' + o.note + '）');
  return parts.join(' ');
}

const toCup = (o) => ({ id: o.id, text: desc(o), item: o.item, price: o.price, pay: payOf(o), paid: !!o.paid, told: o.told || '' });

// 還沒收的杯子都說付了才算「說已付」；兩種都有就是「匯款＋現金」
function toldOf(cups) {
  const open = cups.filter((c) => !c.paid);
  if (!open.length || open.some((c) => !c.told)) return '';
  const kinds = new Set(open.map((c) => c.told));
  return kinds.size > 1 ? '都有' : [...kinds][0];
}
const STATUS = { 匯款: '說已匯款', 現金: '說已給現金', 都有: '說已匯款＋給現金' };

/**
 * 一團的帳。
 * 回傳 { cups, total, got, shop: [{text, n}], people: [{ name, cups, total, due, paid, status, pays, ids, unpaidIds }] }
 * status：收到／說已匯款／說已給現金／說已匯款＋給現金／還沒付。已收（got）照杯算。
 */
export function groupLedger(orders) {
  const os = byTime(orders);
  const shop = new Map();
  os.forEach((o) => { const k = desc(o); shop.set(k, (shop.get(k) || 0) + 1); });
  const byName = new Map();
  os.forEach((o) => { if (!byName.has(o.name)) byName.set(o.name, []); byName.get(o.name).push(toCup(o)); });
  const people = [...byName].map(([name, cups]) => {
    const unpaid = cups.filter((c) => !c.paid);
    const paid = unpaid.length === 0;
    const told = toldOf(cups);
    return {
      name, cups,
      total: sum(cups), due: sum(unpaid), paid,
      status: paid ? '收到' : STATUS[told] || '還沒付',
      pays: [...new Set(cups.map((c) => c.pay))],
      ids: cups.map((c) => c.id), unpaidIds: unpaid.map((c) => c.id),
    };
  });
  return {
    cups: os.length, total: sum(os), got: sum(os.filter((o) => o.paid)),
    shop: [...shop].map(([text, n]) => ({ text, n })), people,
  };
}

/**
 * 某個人在這一團還要付的錢（給「我要付錢」和點完的付款框）。轉帳、現金各一張。
 * 回傳 [{ pay, cups, total, ids, told }]；told 是空的＝還沒說付了。
 */
export function billsFor(orders, name) {
  const mine = byTime(orders).filter((o) => o.name === name && !o.paid).map(toCup);
  return ['轉帳', '現金'].map((pay) => {
    const cups = mine.filter((c) => c.pay === pay);
    return { pay, cups, total: sum(cups), ids: cups.map((c) => c.id), told: toldOf(cups) };
  }).filter((b) => b.cups.length);
}
