# 訂飲料

仁德國小老師訂飲料、分帳用的小網站。

- 網址：https://hniu590.github.io/drinks/
- 老師名單、店家菜單：`data.js`（真的名單和六家店菜單：50嵐、TEA'S原味、茶聚、得正、迷客夏、COMEBUY）
- 資料庫門鎖（Firebase 規則）：`firestore.rules`，改了要貼到 Firebase 控制台按發布

## 程式怎麼分

- `app.js`：畫面（排版、按鈕）
- `store.js`：資料存取（正式，連 Firebase）；`store-memory.js`：同樣的動作，測試用的假資料庫
- `ledger.js`：帳本（誰點了什麼、該付多少、付了沒）
- `deadline.js`：截止時間（能不能點、留多久、怎麼寫）
- `howto.js`：首頁「怎麼用？」的步驟。功能改了記得一起改這裡
- 用語見 `GLOSSARY.md`

## 改程式前後

考卷全對才上線：

```
node --test ledger.test.js deadline.test.js store.test.js
PLAYWRIGHT=<playwright 的 index.mjs> CHROME=<chromium> node tests/flow.mjs
```

`tests/flow.mjs` 在瀏覽器把兩條流程（團主開團收錢、同事點飲料付錢）跑一遍，用假資料庫，不會碰到正式資料。
