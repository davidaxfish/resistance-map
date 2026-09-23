# 阻力地圖 Resistance Map

高工時工程師的 3 分鐘測驗：17 題 → 五大阻力雷達圖 → 3 個今天就能做的行動 → 依承諾度分流到預約電話或 IG 私訊。

純 HTML / CSS / JS，沒有框架、沒有 localStorage、沒有追蹤碼。

```
resistance-map/
├─ index.html              外殼（不含文案）
├─ style.css               視覺 token 與版面
├─ app.js                  流程、計分、SVG 雷達圖、hash 還原、webhook
├─ data.json               唯一資料來源（全部文案、連結、設定）
├─ google-apps-script.gs   Google Sheet 名單表（貼到 Apps Script）
├─ assets/                 成果照片與餐點照片
└─ tests/
   ├─ scoring.test.js      計分、同分規則、hash、分流測試
   └─ copy-check.js        文案規則檢查＋程式碼有沒有寫死中文
```

---

## 1. 本機測試

`fetch` 讀取 `data.json` 需要本機伺服器，直接雙擊 index.html 會讀不到資料。

```bash
cd resistance-map
python3 -m http.server 8000
```

打開 http://localhost:8000

自動測試（需要 Node.js）：

```bash
node tests/scoring.test.js
node tests/copy-check.js
```

每次改完 data.json 建議跑一次 `copy-check.js`，它會抓「底層邏輯」、破折號、「不是……是……」句型、半型標點、醫療字眼。

---

## 2. 部署到 GitHub Pages

1. 把 `resistance-map/` 資料夾推到你的 repo（例如 `fu-system/resistance-map/`）。
2. GitHub repo → Settings → Pages → Source 選 `Deploy from a branch`，Branch 選 `main`、資料夾選 `/ (root)`，Save。
3. 約 1 分鐘後網址會是 `https://<帳號>.github.io/<repo>/resistance-map/`。
4. GitHub Pages 對 data.json 有約 10 分鐘快取，改完文案看不到變化，等一下或加 `?v=2` 重新整理。

---

## 3. 修改 data.json

所有畫面文字都在 data.json，改完存檔重新整理即可，不用碰程式。

| 區塊 | 內容 |
|---|---|
| `config.calendlyUrl` | 預約連結 |
| `config.webhookUrl` | 名單 webhook，留空就不送任何請求 |
| `config.webhookMode` | `simple`（預設，Apps Script 與 Make 都能收）或 `json` |
| `config.igDmUrl` | IG 私訊連結，例如 `https://ig.me/m/你的帳號`。留空時只顯示關鍵字和「複製關鍵字」按鈕 |
| `config.dmKeyword` | 私訊關鍵字（目前是「系統」） |
| `config.audio` | 配樂檔路徑、音量、開關文案。`src` 留空就不顯示配樂按鈕 |
| `config.commitmentThreshold` | 幾分以上顯示預約按鈕（目前 9） |
| `config.lowResistanceMaxPercent` | 全部阻力 ≤ 此百分比時顯示低阻力型（目前 33，也就是每項 3/9 分以下） |
| `meta` | 瀏覽器分頁標題與描述 |
| `ui` | 入口、按鈕、進度、提示、計算中、結果頁標籤 |
| `scale` | 4 級頻率量表 |
| `contextQuestions` | 2 題情境題（不計分） |
| `resistances.X` | 阻力名稱、雷達軸標籤、定義、診斷（本質／後果）、3 個行動與分鐘數 |
| `questionOrder` | 15 題出題順序 |
| `questions.X` | 題目文案；`"impact": true` 代表生活影響題（同分判定用） |
| `lowType` `gap` `cta` `lead` | 低阻力型、落差說明、CTA 分流、留資表單 |
| `proof` | 前後對比照與故事（照片放 `assets/`，`width` `height` 填原圖尺寸） |
| `meals` | 餐點照片滑動列，每張有標籤與一句說明，可增減 |
| `method` | 方法方向預告；`hits` 填對應的阻力代號，命中使用者最大阻力時會標「你的最大阻力」 |
| `follow` | IG 與 Skool 連結 |

文案裡的 `{n}` `{p}` `{m}` `{keyword}` 這類大括號是變數，保留它們。

### 計分規則

- 每個阻力 3 題加總（0 到 9），百分比 = 分數 / 9 × 100（四捨五入顯示）。
- 最大阻力 = 百分比最高者。同分時比生活影響題（第 3 題），再同分依 D → P → S → E → U。
- 全部 ≤ 33% 顯示低阻力型，行動仍取最高的那一項。

### 結果網址

結果頁網址會自動變成：

```
#r=D3-P7-S2-E5-U4&k=12030&c=9&g=1&w=2
```

- `r` 五個阻力原始分數，`c` 承諾度
- `k` 五個生活影響題分數（讓分享連結也能正確套用同分規則，可省略）
- `g` `w` 情境題選項編號（可省略）

私訊時請對方把網址貼給你，打開就是他的阻力地圖。

---

## 4. 名單進 Google Sheet

**目前已經接好，用 Make.com（已上線運作）**

- Webhook：`https://hook.us2.make.com/jehbyi9j3rhylxi863nh3ji3u35u6h1b`（已填入 `config.webhookUrl`，`webhookMode: json`）
- Make Scenario：`阻力地圖_名單寫入 Google Sheet`（ID 6373415，Immediately，已啟用）
- Google 連線：`Google Sheets - 阻力地圖名單`（ID 11262690）
- 試算表：`1wXxJfsGi8Z4I9pGchprrsSQdXHKIbMudT7yNTwDIFCs`，兩個分頁：

| 分頁 | 內容 |
|---|---|
| `leads` | 原始紀錄，每個事件一列（A 到 Y 共 25 欄），Make 用 Sheets API append 寫入 |
| `名單` | 追銷用。A2 一條公式把 `leads` 去重，每個 sessionId 只留最新一列（通常就是留了 IG 和 Email 的那筆） |

`名單!A2` 的公式：

```
=IFERROR(SORTN(SORT(INDIRECT("leads!A2:Y"), 3, FALSE), 9^9, 2, 1, TRUE), "")
```

用 `INDIRECT` 是因為直接寫 `leads!A2:Y` 會在寫入新列時被 Google Sheets 位移。append 也設成 `insertDataOption=OVERWRITE`，同樣是避免位移。`receivedAt` 帶到秒，讓同一個人的 `lead` 事件排在 `complete` 之後。

要改欄位時，`leads!A1:Y1` 的標題、`名單!A1:Y1` 的標題，以及 Scenario 第 2 個模組 body 裡的 25 個值要一起改。

Make 免費方案同時只能啟用一個 Scenario，要跑其他流程時記得檢查這支有沒有被關掉。

---

### 備案 A：Google Apps Script（不用 Make 時才需要）

1. 新建一個 Google 試算表，命名例如「阻力地圖名單」。
2. 擴充功能 → Apps Script，把 `google-apps-script.gs` 全部貼上，存檔。
3. 部署 → 新增部署作業 → 類型選「網頁應用程式」
   - 執行身分：我
   - 存取權：所有人
4. 授權後複製 `/exec` 結尾的網址，貼到 `data.json` 的 `config.webhookUrl`，`webhookMode` 維持 `simple`。
5. 做一次測驗，試算表會自動建立 `leads` 分頁與欄位。

同一次測驗的三個事件會更新同一列（依 `sessionId`）：

| event | 何時送出 |
|---|---|
| `complete` | 看到結果頁的那一刻 |
| `reason` | 承諾度 ≤ 8 的人選了「沒給 10 分的原因」 |
| `lead` | 送出 IG／Email |

最後一欄 `followUpStatus` 留給你手動標註追銷進度，程式不會覆蓋。

> 改過 Apps Script 程式碼後要「管理部署作業 → 編輯 → 新版本」，網址不變。

### 備案 B：自己重建 Make 流程

1. Make 新增 Scenario → 第一個模組 `Webhooks > Custom webhook`，複製網址貼到 `config.webhookUrl`。
2. `webhookMode`：
   - `json`：Make 會自動解析欄位，最方便。
   - `simple`：瀏覽器用 text/plain 送出（避開 CORS 預檢）。若 Make 沒抓到欄位，在 webhook 後面加 `JSON > Parse JSON`，Data 選 webhook 收到的原始內容。
3. 做一次測驗讓 Make「Determine data structure」。
4. 加 `Google Sheets > Search Rows`（條件 `sessionId` 等於本次 sessionId）
   → Router：
   - 找到 → `Update a Row`
   - 沒找到 → `Add a Row`
5. 建議再加一條分支：`ctaBranch = call` 或 `email` 有值時，發通知到你的 LINE／Email，當天就能跟進。

### Payload

```json
{
  "goal": "瘦下來之後穩定維持，不再復胖",
  "whyNow": "已經試過很多次，不想再重來",
  "scores":  { "D": 6, "P": 7, "S": 2, "E": 9, "U": 4 },
  "percent": { "D": 67, "P": 78, "S": 22, "E": 100, "U": 44 },
  "topResistance": "E",
  "commitment": 7,
  "reasonNot10": "怕又失敗一次",
  "ig": "@someone",
  "email": "someone@example.com",
  "resultUrl": "https://davidaxfish.github.io/resistance-map/#r=D6-P7-S2-E9-U4&k=12330&c=7",
  "topResistanceName": "情緒代償",
  "completedAt": "2026-09-21T13:10:35.129Z",
  "sessionId": "uuid",
  "event": "lead",
  "ctaBranch": "dm",
  "isLow": false
}
```

`ig` `email` `line` 來自結果頁的「免費索取」表單（兩欄必填，可在 `data.json` 的 `lead.fields` 增減欄位或改 `required`）；`resultUrl` 可以直接點開對方的阻力地圖；`sessionId` `event` `ctaBranch` `isLow` 用於 Sheet 去重與分流追銷。

---

## 5. 串 ManyChat 關鍵字「系統」

承諾度 ≤ 8 的人會被引導到 IG 私訊關鍵字「系統」。建議流程：

1. **ManyChat → Automation → Keyword**：IG DM 包含「系統」時觸發。
2. **第一則回覆**：謝謝他做完測驗，請他貼上結果頁網址，或直接回覆他最大的阻力是哪一個。
3. **User Input**：把他貼的網址存到自訂欄位 `resistance_url`。
4. **External Request（可選）**：把 `resistance_url` 和 IG username POST 到 Make webhook。
   Make 解析網址 `#r=` 算出最大阻力（或用 `ig` 欄位比對 Sheet 已有的列），回傳 `topResistance` 給 ManyChat。
5. **Condition**：依 `topResistance` 分到 5 個不同開場訊息（第二階段待辦）。
6. 對話中判斷他準備好了，再送 Calendly 連結。

表單裡的 `ig` 欄位可以直接在 Sheet 裡對上 ManyChat 的對話。

---

## 6. 設計備註

- 字體：英數用 JetBrains Mono（Google Fonts 非同步載入），中文用系統宋體（iOS 與 macOS 是 Songti TC，Android 是 Noto Serif CJK，Windows 是 MingLiU）。
  中文字型從 Google Fonts 載入要多下載約 1.5MB，手機版 Lighthouse 分數會掉到 60 左右，所以改用系統字型。
- 視覺：螢光黃到琥珀金的漸層（`--grad`），卡片頂端細光線、雷達圖漸層描邊與光暈、CTA 呼吸光暈、主按鈕掃光。全部在 `style.css` 的 `:root` 調色。
- 配樂：`config.audio`。`src` 指到音檔，右上角會出現配樂開關，按「開始測驗」時自動播放（瀏覽器規定要有使用者操作才能播）。
  `src` 留空或檔案不存在時，開關會自動消失。**放上線的音檔需要有授權**，商用授權可用 Epidemic Sound、Artlist，免費可用 YouTube Audio Library、Pixabay Music。
- 支援 `prefers-reduced-motion`：雷達圖展開、光暈、過場動畫全部關閉。
- 選項可用鍵盤數字 1 到 4 作答。

---

## 7. 第二階段待辦（尚未實作）

- [ ] 結果圖下載：Canvas 輸出 1080×1350（限時動態尺寸），含雷達圖與最大阻力。
- [ ] 依最大阻力自動觸發不同的 DM 開場腳本（ManyChat Condition 分 5 支，搭配第 5 節流程）。
- [ ] 內容行銷導流：`resistances.X` 加一個 `videoUrl` 欄位，結果頁對應一集短影音。
