// 資料存取：畫面要讀寫資料都經過這裡，不直接碰 Firebase。
// 這個檔是「正式」的轉接器（Firebase）；測試用 store-memory.js，兩個做一樣的事。
// 回傳給畫面的資料：團 { id, storeId, storeName, leader, account, deadline: Date, closed }
//                   一杯 { id, name, item, size, sugar, ice, toppings, note, price, pay, paid, told, createdAt: 毫秒或 null }
// 每個動作能改哪些欄位，要跟 firestore.rules（資料庫門鎖）一致。2026/11/2 老師決定加這個接縫。
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, collection, doc, addDoc, setDoc, getDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, serverTimestamp, Timestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const app = initializeApp({
  apiKey: 'AIzaSyC_MlCzdRT0KBtdrFKNUAzD5kiH-CVo07M',
  authDomain: 'rdes07-89859.firebaseapp.com',
  projectId: 'rdes07-89859',
  storageBucket: 'rdes07-89859.firebasestorage.app',
  messagingSenderId: '426676002934',
  appId: '1:426676002934:web:81f18d96dbae516140bf57',
});
const db = getFirestore(app);

const ms = (t) => (t && t.toMillis ? t.toMillis() : null);
const toGroup = (d) => { const x = d.data(); return { ...x, id: d.id, deadline: x.deadline ? x.deadline.toDate() : null, createdAt: ms(x.createdAt) }; };
const toCup = (d) => { const x = d.data(); return { ...x, id: d.id, createdAt: ms(x.createdAt) }; };
const cupsOf = (gid) => collection(db, 'groups', gid, 'orders');

/** 最近的團（截止時間在 since 之後）和每團的點單，有變就呼叫 onChange(groups, ordersByGroupId)。回傳「停止」。 */
export function watchRecent(since, onChange, onError) {
  const stops = []; const groups = {}; const orders = {};
  const emit = () => onChange(Object.values(groups), orders);
  stops.push(onSnapshot(query(collection(db, 'groups'), where('deadline', '>', Timestamp.fromDate(since))), (snap) => {
    const ids = new Set(snap.docs.map((d) => d.id));
    snap.docs.forEach((d) => {
      if (!groups[d.id]) stops.push(onSnapshot(cupsOf(d.id), (s) => { orders[d.id] = s.docs.map(toCup); emit(); }, onError));
      groups[d.id] = toGroup(d);
    });
    Object.keys(groups).forEach((id) => { if (!ids.has(id)) delete groups[id]; });
    emit();
  }, onError));
  return () => stops.forEach((s) => s());
}

/** 一團：onGroup(團或 null＝找不到)、onCups(點單)。回傳「停止」。 */
export function watchGroup(gid, onGroup, onCups, onError) {
  const a = onSnapshot(doc(db, 'groups', gid), (d) => onGroup(d.exists() ? toGroup(d) : null), onError);
  const b = onSnapshot(cupsOf(gid), (s) => onCups(s.docs.map(toCup)), onError);
  return () => { a(); b(); };
}

/** 這個人存過的郵局帳號（沒有就空字串） */
export async function getAccount(name) {
  const d = await getDoc(doc(db, 'people', name));
  return d.exists() ? d.data().account || '' : '';
}

/** 開團（順便記住團主的帳號），回傳團的 id */
export async function openGroup({ storeId, storeName, leader, account, deadline }) {
  await setDoc(doc(db, 'people', leader), { account });
  const ref = await addDoc(collection(db, 'groups'), {
    storeId, storeName, leader, account, deadline: Timestamp.fromDate(deadline), createdAt: serverTimestamp(), closed: false,
  });
  return ref.id;
}

/** 點一杯 */
export async function addCup(gid, { name, item, size, sugar, ice, toppings, note, price, pay }) {
  await addDoc(cupsOf(gid), { name, item, size, sugar, ice, toppings, note, price, pay, paid: false, createdAt: serverTimestamp() });
}

/** 刪掉一杯 */
export const removeCup = (gid, id) => deleteDoc(doc(db, 'groups', gid, 'orders', id));

async function updateCups(gid, ids, data) {
  const b = writeBatch(db);
  ids.forEach((id) => b.update(doc(db, 'groups', gid, 'orders', id), data));
  await b.commit();
}
/** 付錢的人說付了：kind 是「匯款」「現金」，空字串＝按錯了收回 */
export const tell = (gid, ids, kind) => updateCups(gid, ids, { told: kind });
/** 團主打勾（true）或取消（false） */
export const markPaid = (gid, ids, paid) => updateCups(gid, ids, { paid });
/** 結束點單（true）或重新開放（false） */
export const setClosed = (gid, closed) => updateDoc(doc(db, 'groups', gid), { closed });
