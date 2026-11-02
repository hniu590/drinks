// 截止時間：能不能點、要在哪一區留多久、怎麼寫給人看、開團的預設時間。
// 「現在幾點」一律從外面傳進來（now），所以考卷可以測午夜、明天這些情況。
// 考卷：deadline.test.js。2026/11/2 老師決定收成一份。

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** 截止後還留多久：首頁 12 小時、我開的團 3 天、我要付錢 7 天（老師 11/2 決定） */
export const KEEP = { home: 12 * HOUR, mine: 3 * DAY, pay: 7 * DAY };

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayDiff = (d, now) => Math.round((midnight(d) - midnight(now)) / DAY);

/** 11/2（一） */
export const mdw = (d) => `${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）`;

/** 還能點：沒按結束點單，而且還沒到截止時間 */
export const isOpen = (g, now) => !g.closed && (!g.deadline || g.deadline > now);

/** 這一團在某一區（home／mine／pay）還要不要出現 */
export const shows = (g, area, now) => !g.deadline || g.deadline.getTime() > now.getTime() - KEEP[area];

/** 畫面上的截止時間：今天「15:00」、明天「明天 15:00」、其他「11/5（四） 15:00」 */
export function whenText(d, now) {
  const n = dayDiff(d, now);
  return (n === 0 ? '' : n === 1 ? '明天 ' : mdw(d) + ' ') + hhmm(d);
}

/** 貼 LINE 的：不是今天就把日期寫清楚，例：「明天 11/3（二） 15:00」 */
export function whenLine(d, now) {
  const n = dayDiff(d, now);
  return n === 0 ? hhmm(d) : (n === 1 ? '明天 ' : '') + mdw(d) + ' ' + hhmm(d);
}

/** 排序用：點單中的在前、先截止的先；已截止的在後、最近截止的先。用法：list.sort(byDeadline(now)) */
export const byDeadline = (now) => (a, b) => {
  const oa = isOpen(a, now); const ob = isOpen(b, now);
  if (oa !== ob) return oa ? -1 : 1;
  const diff = (a.deadline || 0) - (b.deadline || 0);
  return oa ? diff : -diff;
};

/** 開團頁的預設：一小時後；今天剩不到一小時就明天 15:00。day：0 今天、1 明天 */
export function defaultDeadline(now) {
  const later = new Date(now.getTime() + HOUR);
  if (later.getDate() === now.getDate()) return { day: 0, time: hhmm(later) };
  return { day: 1, time: '15:00' };
}

/** 開團選的「今天／明天」＋「時:分」變成截止時間；沒填或已經過了回傳 null */
export function makeDeadline(day, time, now) {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  const d = new Date(now); d.setDate(d.getDate() + Number(day)); d.setHours(h, m, 0, 0);
  return d > now ? d : null;
}
