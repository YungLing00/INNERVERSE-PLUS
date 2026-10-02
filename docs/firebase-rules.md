# Firebase Realtime Database 安全規則說明

規則檔：`database.rules.json`（可直接貼到 Firebase 主控台 →Realtime Database →規則，或用 `firebase deploy --only database` 部署）。

## 大原則

1. **預設全部關閉**：根目錄 `.read` / `.write` 都是 `false`，只有下面列出的路徑才會開放。
2. **只有匿名登入的玩家能用**：每條規則都檢查 `auth.token.firebase.sign_in_provider == 'anonymous'`，沒登入的人或用其他方式登入的人都讀不到、寫不進。
3. **自己的資料只有自己能改**：所有資料都用 Firebase 匿名登入給的 `auth.uid` 當鑰匙，規則會比對「寫的人」是不是「資料的主人」。
4. **欄位白名單＋格式檢查**：不在清單裡的欄位一律拒絕；文字有長度上限；時間一律要用伺服器時間（`serverTimestamp()`），不能偽造。

## 資料結構與權限

| 路徑 | 誰能讀 | 誰能寫 | 說明 |
|---|---|---|---|
| `planets/{uid}` | 所有匿名玩家 | 只有本人 | 公開的星球資料（名字、寵物、五行、Big5、天氣、3D 模型、縮圖，以及星光總數 `lights`，0–100000）。必須同時在 `names/` 登記名字才寫得進去。 |
| `names/{名字小寫}` | 所有匿名玩家 | 先搶先贏；之後只有登記者能改或刪 | 防止名字重複，取代原本的 `checkName`。 |
| `friends/{uid}/{對方uid}` | 所有匿名玩家（用來畫宇宙裡的友情線） | 本人；或對方在「接受邀請」時一起建立 | 只有在**真的有邀請**（對方邀請過你）或**對方已經把你加為朋友**時才能建立，無法單方面硬加。`danceCount` 只能增加。 |
| `inbox/{uid}/invites/{寄件人uid}` | 收件人；寄件人看得到自己寄的那一封 | 寄件人只能用自己的 uid 寄出；收件人或寄件人可刪除 | 共舞邀請。不能冒用別人名義寄。 |
| `inbox/{uid}/outcomes/{對方uid}` | 收件人 | 被邀請者回覆時寫入；收件人可刪除 | 邀請結果（`accepted` / `mutual` / `later`），取代原本 `inbox` 的 outcomes。 |
| `inbox/{uid}/notes/{id}` | 只有收件人 | 有星球的玩家可以留言給別人，不能留給自己、不能覆蓋或刪別人的留言；收件人讀完可刪除 | `from` 必須是寄件人自己的 uid，內容 1–60 字。 |
| `inbox/{uid}/starlight/{id}` | 只有收件人 | 任何匿名玩家可新增；收件人可刪除 | 送星光，`kind` 只能是 star / leaf / drop / light / heart。 |
| `events/{活動id}` | 所有匿名玩家 | 有星球的玩家，且只能改自己那一格 | 「點亮宇宙」活動。見下方。 |

## 「點亮宇宙」活動的防作弊

- 活動 id 必須像 `2026100217`（或測試用的 `A20261002`）。
- 每個人只能改 `events/{id}/parts/{自己的uid}`。
- 一次最多加 5 片碎片，而且和上一次至少相隔 2 秒（跟原本 `Code.gs` 的限制一樣）。
- 總進度 `progress` 增加的量**必須等於**你自己 `parts/{uid}/n` 增加的量，所以不能只改總數灌水。前端要用一次 `update()` 搭配 `increment()` 同時更新兩者。
- 一旦寫入 `done`，就不能再加碎片。

## 前端寫入範例（之後改寫 index.html 時使用）

```js
// 發佈星球（名字登記與星球資料要「一起」寫）
update(ref(db), {
  [`names/${name.toLowerCase()}`]: uid,
  [`planets/${uid}`]: { name, nameKey: name.toLowerCase(), updatedAt: serverTimestamp(), createdAt: serverTimestamp(), /* ... */ }
});

// 送出碎片
update(ref(db, `events/${eventId}`), {
  progress: increment(n),
  [`parts/${uid}/n`]: increment(n),
  [`parts/${uid}/last`]: serverTimestamp(),
  [`parts/${uid}/seen`]: serverTimestamp()
});
```

## 已知限制（規則做不到、需要後端的部分）

- **友情等級**：等級和次數由雙方各自的前端計算，規則只能檢查範圍（1–5）和「只增不減」，無法驗證是否真的跳過舞。
- **星光總數**：`lights` 由星球主人自己寫入，規則只能限制範圍，主人可以自己把數字調高。
- **活動完成**：規則無法計算目標值（需要數參加人數），所以 `done` 只檢查「只能寫一次」。
- **活動時間窗**：規則沒有時區/分鐘函式，無法限制只在每小時前 20 分鐘可以寫入。
- **名字可以先被佔用**：有人可能只登記名字不建星球。若變成問題，可以改由 Cloud Functions 或 Apps Script 處理。

這些都只影響遊戲數字，不會讓人讀到或改到別人的私人資料。

## 測試

`firebase/rules.test.mjs` 用 Firebase 模擬器跑了 43 個情境（正常操作要成功、越權操作要失敗），目前全部通過。執行方式寫在檔案開頭。
