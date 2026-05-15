# 開發規範

## 模組系統

- 整個專案使用 **CommonJS**（`require` / `module.exports`），**不是** ES Module。
  - 例外：`vitest.config.js` 用 `import / export default`，因為 Vitest 自己用 ESM 載入設定檔。
- Node 不需設定 `"type"` 欄位，`package.json` 預設為 CJS。
- 新增模組請延續 CJS 寫法；若你想引入 ESM-only 套件需用動態 `import()`。

## 命名規則

| 項目 | 規則 | 範例 |
| --- | --- | --- |
| JS 檔名（routes / middleware） | camelCase | `authMiddleware.js`、`adminProductRoutes.js` |
| EJS 檔名 | kebab-case | `product-detail.ejs`、`admin-sidebar.ejs` |
| 前端 page JS | kebab-case，與 `pageScript` 變數對應 | `admin-products.js`（由 `pageRoutes.js` 傳 `pageScript: 'admin-products'`） |
| 變數 / 函式 | camelCase | `getOwnerCondition`、`cartItems` |
| 常數 | UPPER_SNAKE_CASE（限模組內常數，如 `Auth.TOKEN_KEY`） | `TOKEN_KEY`、`SAFE_MESSAGES` |
| DB 欄位 | snake_case（SQL 慣例） | `product_id`、`recipient_email`、`created_at` |
| API 請求 body 欄位 | camelCase | `productId`、`recipientName`、`recipientEmail` |
| API 回應欄位 | 與 DB 欄位**一致用 snake_case** | `order_no`、`total_amount`、`image_url` |
| URL Path | kebab-case；資源用複數 | `/api/admin/products`、`/api/orders/:id/pay` |
| Error code | UPPER_SNAKE_CASE | `VALIDATION_ERROR`、`STOCK_INSUFFICIENT` |

**重要差異**：請求 body 用 camelCase（如 `productId`），但 SQL/回應用 snake_case（如 `product_id`）。新端點請維持這個慣例，避免前後端混用。

## 統一回應格式

所有 `/api/*` 端點必須回傳：

```js
{ data: <any|null>, error: <string|null>, message: '...' }
```

- 成功：`error: null`，`message` 為人話訊息（中文）。
- 失敗：`data: null`，`error` 為錯誤碼字串（見 ARCHITECTURE.md 錯誤碼表）。
- 不要回傳 `{ success: true }` 或裸 array。

範例：
```js
res.status(201).json({
  data: { id, name, price, stock },
  error: null,
  message: '商品新增成功'
});
```

```js
return res.status(400).json({
  data: null,
  error: 'VALIDATION_ERROR',
  message: 'name 為必填欄位'
});
```

## 環境變數表

| 變數 | 用途 | 必要性 | 預設值 |
| --- | --- | --- | --- |
| `JWT_SECRET` | JWT 簽章 secret，HS256 | **必填**，缺則 `server.js` 直接 `process.exit(1)` | 無 |
| `PORT` | 伺服器監聽 port | 選填 | `3001` |
| `BASE_URL` | 應用對外網址（OpenAPI server URL 可參考） | 選填 | `http://localhost:3001` |
| `FRONTEND_URL` | CORS 允許的 origin | 選填 | `http://localhost:3001` |
| `ADMIN_EMAIL` | seed 管理員帳號 | 選填 | `admin@hexschool.com` |
| `ADMIN_PASSWORD` | seed 管理員密碼 | 選填 | `12345678` |
| `NODE_ENV` | 環境模式 | 選填 | `undefined`（測試時設為 `test` 會讓 bcrypt saltRounds 降為 1） |
| `ECPAY_MERCHANT_ID` | （保留，未使用） | — | `3002607` |
| `ECPAY_HASH_KEY` | （保留，未使用） | — | — |
| `ECPAY_HASH_IV` | （保留，未使用） | — | — |
| `ECPAY_ENV` | （保留，未使用） | — | `staging` |

- `.env.example` 提供模板，請以 `cp .env.example .env` 起步。
- `.env` 已加入 `.gitignore`，不要 commit 真實 secret。

## JSDoc / OpenAPI 規範

API 路由的註解採用 **swagger-jsdoc** 格式（`@openapi` 起頭），會被 `npm run openapi` 解析。

### 標籤

每個端點都應掛 `tags:`，分類目前有：
- `Auth`
- `Products`
- `Cart`
- `Orders`
- `Admin Products`
- `Admin Orders`

### Security 標籤

- 需要 JWT 的端點：`security: [{ bearerAuth: [] }]`。
- cart 雙模式：`security: [{ bearerAuth: [] }, { sessionId: [] }]`（OpenAPI 中是「或」關係）。
- 公開端點不寫 `security`。

兩個 securityScheme 已於 `swagger-config.js` 註冊：`bearerAuth` 與 `sessionId`（apiKey in header）。

### 範例

```js
/**
 * @openapi
 * /api/products:
 *   get:
 *     summary: 取得商品列表
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 */
router.get('/', (req, res) => { ... });
```

**所有路由 JSDoc 都應同時描述 `data` / `error` / `message` 三層結構**，與實際回應格式對齊。

## 新增功能的步驟

### 新增一個 API 端點（以 `/api/coupons` 為例）

1. **建立路由檔**：`src/routes/couponRoutes.js`
   ```js
   const express = require('express');
   const db = require('../database');
   const authMiddleware = require('../middleware/authMiddleware');
   const router = express.Router();

   router.use(authMiddleware); // 若需要登入才能用

   router.get('/', (req, res) => {
     res.json({ data: [], error: null, message: '成功' });
   });

   module.exports = router;
   ```
2. **掛載至 `app.js`**：
   ```js
   app.use('/api/coupons', require('./src/routes/couponRoutes'));
   ```
   **注意順序**：若同時要有 admin 版本，admin 路由必須**先**掛載，避免被一般路由的 `:id` 通配吃掉。
3. **撰寫 JSDoc 註解** 並執行 `npm run openapi` 確認可被解析。
4. **新增測試** `tests/coupons.test.js` 並在 `vitest.config.js` 的 `sequence.files` 中插入正確順序（見 TESTING.md）。

### 新增一支 middleware

1. 檔案放在 `src/middleware/<功能>Middleware.js`。
2. 簽章 `(req, res, next)`，必要時呼叫 `next(err)` 進入 errorHandler。
3. 若失敗請直接回 `res.status(...).json({ data: null, error: '<CODE>', message: '...' })`，不要丟到 errorHandler（errorHandler 主要兜底 unexpected）。
4. 全域中介於 `app.js` 註冊；路由級中介在對應 routes 檔內 `router.use(...)`。

### 新增 DB 欄位／表

`src/database.js` 的 `initializeDatabase()` 是唯一的 schema 來源（無 migration 工具）：

1. 修改 `CREATE TABLE IF NOT EXISTS` 區塊。**重點：`IF NOT EXISTS` 對既有資料庫不會 ALTER**，所以新增欄位需手動處理：
   - 開發階段最快：刪除 `database.sqlite*` 三檔讓專案重建（會遺失所有資料）。
   - 正規做法：在 `initializeDatabase()` 末尾追加 `try { db.exec('ALTER TABLE ... ADD COLUMN ...'); } catch (e) {}` 之類的條件式遷移，並在 PR 描述清楚。
2. 若新表，需要 seed 資料則仿照 `seedProducts()` 寫成獨立函式並於 `initializeDatabase()` 末尾呼叫。
3. `created_at` / `updated_at` 一律使用 `TEXT NOT NULL DEFAULT (datetime('now'))`。更新時須手動 `SET updated_at = datetime('now')`（沒有 trigger）。

### 新增 SSR 頁面

1. 新增 `views/pages/<name>.ejs`（前台）或 `views/pages/admin/<name>.ejs`（後台）。
2. 若有 client interaction，新增對應的 `public/js/pages/<name>.js`（Vue 3 createApp）。
3. 在 `src/routes/pageRoutes.js` 加入 `router.get('/<path>', (req, res) => renderFront(res, '<name>', { title: '...', pageScript: '<name>' }))`。
   - 後台用 `renderAdmin` 並要傳 `currentPath` 讓 sidebar 高亮。
4. **不要**從伺服器端傳機密資料（layout 沒有沙箱），所有資料都以 API 提供，由 `apiFetch` 讀取。

## 計畫歸檔流程

`docs/plans/` 用來追蹤「進行中」的開發計畫，`docs/plans/archive/` 用來保存已完成計畫供日後參考。

1. **計畫檔案命名格式**：`YYYY-MM-DD-<feature-name>.md`
   - 範例：`2026-05-14-coupon-system.md`、`2026-06-01-ecpay-integration.md`
   - 日期使用「計畫**建立**日期」（非完成日）。
2. **計畫文件結構**：`User Story → Spec → Tasks`
   ```markdown
   # <feature-name>

   ## User Story
   As a <role>, I want <action>, so that <outcome>.

   ## Spec
   - 範圍、API、UI、資料模型...
   - 不在範圍 (Out of scope)
   - 邊界與錯誤處理

   ## Tasks
   - [ ] Task 1
   - [ ] Task 2
   ```
3. **功能完成後**：
   - 將 `docs/plans/<檔名>.md` 移至 `docs/plans/archive/<檔名>.md`（保留同檔名）。
   - 更新 `docs/FEATURES.md`：將該功能的狀態改為「✅ 已完成」並補上行為描述。
   - 更新 `docs/CHANGELOG.md`：在最新版本下新增 entry（含日期、簡述、PR/commit 連結）。

## Linting 與格式

目前**未配置** ESLint / Prettier。請維持既有風格：
- 4 spaces？2 spaces？**現有程式碼一律 2 spaces**，新檔案請延續。
- 句尾分號：**保留**。
- 字串：單引號 `'...'` 為主，HTML 屬性內可用 `"..."`。
- 物件結尾 trailing comma：現有程式碼**不加**（例外是 test fixtures），新檔案維持不加即可。
