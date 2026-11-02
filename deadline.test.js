// 截止時間考卷：node --test deadline.test.js。「現在幾點」都從外面給，不看電腦時鐘。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEEP, isOpen, shows, whenText, whenLine, mdw, byDeadline, defaultDeadline, makeDeadline } from './deadline.js';

const at = (s) => new Date(s); // 台灣時間寫法：'2026-11-02T14:00'
const NOW = at('2026-11-02T14:00'); // 星期一下午兩點
const g = (deadline, closed = false) => ({ deadline: at(deadline), closed });

test('日期寫法：11/2（一）', () => {
  assert.equal(mdw(NOW), '11/2（一）');
});

test('能不能點：截止前、沒按結束才可以', () => {
  assert.equal(isOpen(g('2026-11-02T15:00'), NOW), true);
  assert.equal(isOpen(g('2026-11-02T13:59'), NOW), false);
  assert.equal(isOpen(g('2026-11-02T15:00', true), NOW), false, '團主按了結束點單');
  assert.equal(isOpen(g('2026-11-02T14:00'), NOW), false, '剛好到截止時間就不能點');
});

test('截止時間給人看：今天只寫時間、明天寫「明天」、其他寫日期', () => {
  assert.equal(whenText(at('2026-11-02T15:00'), NOW), '15:00');
  assert.equal(whenText(at('2026-11-03T09:05'), NOW), '明天 09:05');
  assert.equal(whenText(at('2026-11-05T15:00'), NOW), '11/5（四） 15:00');
  assert.equal(whenText(at('2026-11-01T15:00'), NOW), '11/1（日） 15:00', '昨天的寫日期');
});

test('貼 LINE 的：不是今天就寫清楚日期', () => {
  assert.equal(whenLine(at('2026-11-02T15:00'), NOW), '15:00');
  assert.equal(whenLine(at('2026-11-03T15:00'), NOW), '明天 11/3（二） 15:00');
  assert.equal(whenLine(at('2026-11-05T15:00'), NOW), '11/5（四） 15:00');
});

test('跨午夜：晚上 11:50 看「明天 00:30」', () => {
  assert.equal(whenText(at('2026-11-03T00:30'), at('2026-11-02T23:50')), '明天 00:30');
});

test('留多久：首頁截止後 12 小時、我開的團 3 天、我要付錢 7 天', () => {
  assert.deepEqual(Object.keys(KEEP).sort(), ['home', 'mine', 'pay']);
  const before = (h) => g(new Date(NOW.getTime() - h * 3600e3).toISOString());
  assert.equal(shows(before(11), 'home', NOW), true);
  assert.equal(shows(before(13), 'home', NOW), false);
  assert.equal(shows(before(71), 'mine', NOW), true);
  assert.equal(shows(before(73), 'mine', NOW), false);
  assert.equal(shows(before(167), 'pay', NOW), true);
  assert.equal(shows(before(169), 'pay', NOW), false);
  assert.equal(shows(g('2026-11-03T15:00'), 'home', NOW), true, '還沒截止的一定看得到');
});

test('排序：點單中的在前、先截止的先；已截止的在後、最近截止的先', () => {
  const a = { id: 'a', ...g('2026-11-02T16:00') };
  const b = { id: 'b', ...g('2026-11-02T15:00') };
  const c = { id: 'c', ...g('2026-11-01T15:00') };
  const d = { id: 'd', ...g('2026-11-02T10:00') };
  const e = { id: 'e', ...g('2026-11-02T18:00', true) };
  assert.deepEqual([a, c, b, d, e].sort(byDeadline(NOW)).map((x) => x.id), ['b', 'a', 'e', 'd', 'c']);
});

test('開團預設時間：一小時後；今天剩不到一小時就明天 15:00', () => {
  assert.deepEqual(defaultDeadline(at('2026-11-02T14:07')), { day: 0, time: '15:07' });
  assert.deepEqual(defaultDeadline(at('2026-11-02T23:10')), { day: 1, time: '15:00' });
});

test('開團的截止時間：今天或明天加上時分；已經過了就是 null', () => {
  assert.equal(makeDeadline(0, '15:00', NOW).getTime(), at('2026-11-02T15:00').getTime());
  assert.equal(makeDeadline(1, '09:30', NOW).getTime(), at('2026-11-03T09:30').getTime());
  assert.equal(makeDeadline(0, '13:00', NOW), null);
  assert.equal(makeDeadline(0, '14:00', NOW), null, '剛好現在也算過了');
  assert.equal(makeDeadline(0, '', NOW), null);
});
