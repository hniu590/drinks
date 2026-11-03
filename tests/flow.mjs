// 兩條流程（團主開團收錢、同事點飲料付錢）在真的瀏覽器裡跑一遍。
// 不連 Firebase：把 store.js 換成 store-memory.js（假資料庫轉接器）。
// 需要 Playwright：PLAYWRIGHT=<playwright 的 index.mjs> CHROME=<chromium 執行檔> node tests/flow.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const type = (f) => (f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html');
await page.route('http://site/**', (r) => {
  let f = new URL(r.request().url()).pathname.slice(1) || 'index.html';
  if (f === 'store.js') f = 'store-memory.js'; // ← 接縫：正式換成測試
  r.fulfill({ body: fs.readFileSync(path.join(root, f)), contentType: type(f) });
});
await page.route('https://www.gstatic.com/**', (r) => r.abort()); // 保證沒連到 Firebase

let pass = 0; let fail = 0;
const ok = (name, cond) => { if (cond) pass++; else fail++; console.log((cond ? '✔ ' : '✘ ') + name); };
const T = async () => (await page.locator('#app').innerText()).replace(/\s+/g, ' ');
const go = async (h) => { await page.evaluate((x) => { location.hash = '#/x'; location.hash = x; }, h); await page.waitForTimeout(120); };
const as = (n) => page.evaluate((x) => (x ? localStorage.setItem('drinks.me', JSON.stringify(x)) : localStorage.removeItem('drinks.me')), n);
const T$ = () => page.evaluate(() => window.__drinksTesting);

await page.goto('http://site/index.html'); await page.waitForTimeout(200);
ok('網站載入、用的是假資料庫', !!(await T$()));

// ===== 首頁、怎麼用？ =====
await as('王懷憲'); await go('#/');
ok('首頁沒有團時有「當第一個」提示', (await T()).includes('當第一個'));
await page.click('.howto summary'); await page.waitForTimeout(80);
let t = await T();
ok('「怎麼用？」打開有兩張流程圖', t.includes('我要開團（團主）') && t.includes('我要點飲料（跟團）') && await page.locator('.flow li').count() === 9);

// ===== 團主開團 =====
await page.click('a.btn.primary[href="#/new"]'); await page.waitForTimeout(120);
ok('開團頁自動選好「我是誰」', (await page.locator('.chips[data-group=leader] .chip.on').innerText()) === '王懷憲');
await page.click('#go'); ok('沒填帳號會擋', (await page.locator('#msg').innerText()).includes('郵局帳號'));
await page.fill('#account', '0001234-0567890');
await page.click('.chips[data-group=day] .chip >> nth=0');
await page.fill('#deadline', '00:00'); await page.click('#go'); await page.waitForTimeout(80);
ok('今天已過的時間會擋', (await page.locator('#msg').innerText()).includes('已經過了'));
await page.click('.chips[data-group=day] .chip >> nth=1');
await page.fill('#deadline', '15:00'); await page.click('#go'); await page.waitForTimeout(200);
const gid = (await page.evaluate(() => location.hash)).match(/g\/([^/]+)/)[1];
t = await T();
ok('開團後到彙整頁、LINE 那段寫明天', t.includes('開團成功') && t.includes('明天') && t.includes('15:00 截止'));
await go('#/mine'); ok('我開的團看得到這團', (await T()).includes('看彙整、對帳'));

// ===== 跟團點飲料 =====
async function order(name, item, pay, { add = false } = {}) {
  await as(add ? '' : name); await go('#/g/' + gid);
  if (await page.locator('#more').count()) { await page.click('#more'); await page.waitForTimeout(60); }
  if (add) {
    await page.click('#addname'); await page.fill('#newname', name); await page.click('#addok'); await page.waitForTimeout(60);
  } else {
    await page.click(`.chips[data-group=name] .chip[data-value="${name}"]`);
  }
  await page.click(`.item >> text="${item}"`);
  await page.click('#send'); await page.waitForTimeout(60);
  const firstMsg = await page.locator('#msg').innerText();
  await page.click('.chips[data-group=size] .chip:not([hidden]) >> nth=0');
  await page.click('.chips[data-group=sugar] >> text=半糖'); await page.click('.chips[data-group=ice] >> text=少冰');
  await page.click(`.chips[data-group=pay] >> text=${pay}`);
  await page.click('#send'); await page.waitForTimeout(150);
  return firstMsg;
}
await as('陳淑貞'); await go('#/g/' + gid);
ok('點飲料頁有付款提示', (await page.locator('.hint').innerText()).includes('請在備註寫上自己的名字'));
ok('點飲料頁有「＋ 名單沒有我」', await page.locator('#addname').count() === 1);
ok('沒選完會提示（先選大小）', (await order('陳淑貞', '茉莉綠茶', '轉帳')).includes('先選大小'));
let done = await T();
ok('點完顯示要付 40 元給王懷憲＋帳號＋備註名字＋我匯好了', done.includes('40 元') && done.includes('0001234-0567890') && done.includes('請備註自己的名字') && done.includes('我匯好了'));
await page.click('#more'); await page.waitForTimeout(60);
await page.click('.item >> text="阿薩姆紅茶"'); await page.click('.chips[data-group=size] .chip:not([hidden]) >> nth=0');
await page.click('.chips[data-group=sugar] >> text=無糖'); await page.click('.chips[data-group=ice] >> text=去冰');
await page.click('#send'); await page.waitForTimeout(150);
ok('再點一杯後總共 80 元', (await page.locator('#done').innerText()).includes('80 元'));
await page.click('#tellNow'); await page.waitForTimeout(120);
ok('按「我匯好了」後顯示已告訴團主', (await page.locator('#done').innerText()).includes('已告訴團主匯好了'));
await order('龍潘凱勤', '黃金烏龍', '現金');
done = await page.locator('#done').innerText();
ok('現金的人不顯示帳號、有「我給現金了」', !done.includes('0001234') && done.includes('我給現金了'));

// 臨時名字（＋）
await as(''); await go('#/g/' + gid);
await page.click('#addname'); await page.click('#addok'); await page.waitForTimeout(40);
ok('＋ 沒打名字會提示', (await page.locator('#addmsg').innerText()).includes('先打'));
await page.fill('#newname', '一二三四五六七八九十一');
ok('＋ 名字最多 10 個字', (await page.locator('#newname').inputValue()).length === 10);
await page.click('#addno');
await order('林代課', '四季春青茶', '轉帳', { add: true });
ok('臨時名字「林代課」點好了', (await page.locator('#done').innerText()).includes('林代課'));
await as(''); await go('#/g/' + gid);
ok('臨時名字出現在這一團的名單', await page.locator('.chips[data-group=name] .chip[data-value="林代課"]').count() === 1);
const gid2 = await page.evaluate(async () => { const s = await import('/store.js'); return s.openGroup({ storeId: 'teas', storeName: "TEA'S原味", leader: '蔡睿音', account: '999', deadline: new Date(Date.now() + 3600e3) }); });
await go('#/g/' + gid2);
ok('別團的名單沒有林代課（只在這一團有效）', await page.locator('.chips[data-group=name] .chip[data-value="林代課"]').count() === 0);
await as('林代課'); await go('#/pay');
t = await T();
ok('林代課的手機：我要付錢找得到自己', t.includes('我是 林代課') && t.includes('四季春青茶 大杯 半糖 少冰'));
await as('柯淑華'); await go('#/g/' + gid);
await page.click('.chips[data-group=name] .chip[data-value="柯淑華"]');
ok('只能刪自己的（柯淑華沒點，沒有刪掉按鈕）', await page.locator('.del').count() === 0);
await as('林代課'); await go('#/g/' + gid);
ok('林代課可以刪自己那杯', await page.locator('.del').count() === 1);

// 我要付錢
await as('龍潘凱勤'); await go('#/pay');
ok('我要付錢：現金 40 元、寫完整飲料', (await T()).includes('黃金烏龍 大杯 半糖 少冰') && (await T()).includes('我給現金了'));
await page.click('button.tell'); await page.waitForTimeout(100);
ok('按了變「等團主確認」', (await T()).includes('等團主確認'));
await page.click('button.undo'); await page.waitForTimeout(100);
ok('按錯了可以收回', (await T()).includes('我給現金了'));
await page.click('button.tell'); await page.waitForTimeout(100);

// ===== 團主收錢 =====
await as('王懷憲'); await go('#/mine');
t = await T();
ok('我開的團：4 杯、已收 0 / 160、2 人說已付', t.includes('4 杯') && t.includes('已收 0 / 160 元') && t.includes('2 人說已付'));
await page.click('text=看彙整、對帳'); await page.waitForTimeout(150);
const row = async (n) => (await page.locator('label.row', { hasText: n }).innerText()).replace(/\s+/g, ' ');
const person = async (n) => (await page.locator('.person', { hasText: n }).innerText()).replace(/\s+/g, ' ');
ok('陳淑貞 80 元 說已匯款，下面列兩杯', (await row('陳淑貞')).includes('80 元') && (await row('陳淑貞')).includes('說已匯款') && (await person('陳淑貞')).includes('阿薩姆紅茶 大杯 無糖 去冰'));
ok('龍潘凱勤 說已給現金', (await row('龍潘凱勤')).includes('說已給現金'));
ok('林代課 還沒付', (await row('林代課')).includes('還沒付'));
ok('跟店家說的清單 4 杯', (await T()).includes('共 4 杯，160 元'));
ok('LINE 網址不超出框框', await page.evaluate(() => { const p = document.querySelector('.box pre'); return p.scrollWidth <= p.clientWidth + 1; }));
await page.locator('label.row', { hasText: '陳淑貞' }).locator('input').check(); await page.waitForTimeout(120);
ok('打勾陳淑貞 → 收到、已收 80 / 160', (await row('陳淑貞')).includes('收到') && (await T()).includes('已收 80 / 160'));
await page.click('#toggle'); await page.waitForTimeout(120);
ok('結束點單 → 已截止', (await T()).includes('已截止') && (await T()).includes('重新開放點單'));
await as('柯淑華'); await go('#/g/' + gid);
ok('截止後不能點、沒有刪掉、有看彙整大按鈕', (await T()).includes('已經截止') && await page.locator('.del').count() === 0 && await page.locator('.sumbtn').count() === 1);
await as('陳淑貞'); await go('#/pay'); ok('團主打勾後，陳淑貞沒有要付的錢', (await T()).includes('沒有要付的錢'));
await as('王懷憲'); await go('#/g/' + gid + '/sum'); await page.click('#toggle'); await page.waitForTimeout(100);
await order('陳淑貞', '檸檬綠', '轉帳');
ok('陳淑貞再點一杯後只要付新的那杯 60 元', (await page.locator('#done').innerText()).includes('60 元'));
await as('王懷憲'); await go('#/g/' + gid + '/sum');
ok('彙整：陳淑貞 140 元（還差 60）、已收 80', (await row('陳淑貞')).includes('140 元（還差 60）') && (await T()).includes('已收 80 /'));

// ===== 留多久（12 小時／3 天／7 天） =====
await page.evaluate(() => {
  const H = 3600e3; const T = window.__drinksTesting;
  [['A', 6], ['B', 48], ['C', 120], ['D', 200]].forEach(([n, h]) => {
    T.putGroup({ id: 'keep' + n, storeId: '50lan', storeName: '留' + n, leader: '葉澄銘', account: '1', deadline: Date.now() - h * H });
    T.putCup('keep' + n, { id: 'c' + n, name: '葉澄銘', item: '紅茶', size: '大', sugar: '半糖', ice: '少冰', price: 40, pay: '轉帳' });
  });
});
await as('葉澄銘');
const seen = async (h) => { await go(h); return ((await T()).match(/留[A-D]/g) || []).join(''); };
ok('首頁只留 12 小時內截止的', (await seen('#/')) === '留A');
ok('我開的團留 3 天（最近截止的在前）', (await seen('#/mine')) === '留A留B');
ok('我要付錢留 7 天', (await seen('#/pay')) === '留A留B留C');

// ===== 只能冷飲的飲料（11/3：得正、迷客夏）=====
await page.evaluate(() => {
  const T = window.__drinksTesting;
  T.putGroup({ id: 'hotcold', storeId: 'dezheng', storeName: '得正 八德廣福計劃', leader: '葉澄銘', account: '1', deadline: Date.now() + 3600e3 });
});
await as('葉澄銘'); await go('#/g/hotcold');
const ices = async () => page.$$eval('.chips[data-group=ice] .chip', (cs) => cs.filter((c) => !c.hidden).map((c) => c.dataset.value).join(','));
ok('得正有 5 個分頁', await page.locator('.tab').count() === 5);
await page.click('.item >> text="紅茶"'); ok('原茶可以選溫、熱', (await ices()).includes('熱'));
await page.click('.chips[data-group=ice] >> text=熱');
await page.click('.tab >> text=雙倍水果'); await page.click('.item >> text="檸檬春烏龍"');
ok('水果茶不能選溫、熱，選過的熱被清掉', !(await ices()).includes('熱') && await page.locator('.chips[data-group=ice] .chip.on').count() === 0);
await page.click('.tab >> text=芝士奶蓋'); await page.click('.item >> text="芝士奶蓋春烏龍"');
ok('芝士奶蓋只能少冰、自動選好', (await ices()) === '少冰' && (await page.locator('.chips[data-group=ice] .chip.on').innerText()) === '少冰');
await page.click('.tab >> text=經典奶茶'); await page.click('.item >> text="烘吉奶茶"');
ok('烘吉奶茶只有大杯、自動選好', (await page.locator('.chips[data-group=size] .chip.on').innerText()).includes('大'));
await page.click('.chips[data-group=sugar] >> text=半糖'); await page.click('.chips[data-group=ice] >> text=熱');
await page.click('.chips[data-group=toppings] >> text=/黃金珍珠/'); await page.click('#send'); await page.waitForTimeout(150);
ok('得正 烘吉奶茶熱的＋黃金珍珠 60 元送出', (await T()).includes('60 元'));

console.log(`\n通過 ${pass}，失敗 ${fail}`);
if (errs.length) console.log('畫面錯誤：', errs);
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
