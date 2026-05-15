# 架構說明

本專案是「單一 Express 應用，同時負責 SSR 頁面與 REST API」的單體架構。以下文件描述目錄、啟動流程、API 路由、回應格式、認證機制、資料庫 schema。

---

## 目錄結構

```
.
├── app.js                            # Express app 組裝（中介、靜態、路由、404、錯誤處理）
├── server.js                         # 啟動腳本：檢查 JWT_SECRET → app.listen(PORT)
├── generate-openapi.js               # 從 src/routes/*.js 的 JSDoc 註解產出 openapi.json
├── swagger-config.js                 # swagger-jsdoc 設定（OpenAPI 3.0.3 + 兩種 securitySchemes）
├── vitest.config.js                  # 測試設定：fileParallelism: false，固定 6 個檔案的執行順序
├── package.json                      # 相依套件與 npm scripts
├── database.sqlite                   # SQLite 主資料庫檔（gitignored，啟動時自動建立）
├── database.sqlite-shm / -wal        # WAL 模式產生的伴隨檔
├── .env / .env.example               # 環境變數
│
├── public/                           # Express.static 暴露的靜態檔
│   ├── css/
│   │   ├── input.css                 # Tailwind 入口（含 @theme tokens）
│   │   └── output.css                # Tailwind 編譯產物（gitignored）
│   ├── stylesheets/style.css         # 額外手寫 CSS（保留檔）
│   └── js/
│       ├── auth.js                   # 全域 Auth 物件：token / user / sessionId 的 localStorage 管理
│       ├── api.js                    # 全域 apiFetch()：自動帶 auth header；401 時清登入並導去 /login
│       ├── notification.js           # 全域 Notification.show() Toast
│       ├── header-init.js            # 動態渲染導覽列、購物車徽章
│       └── pages/                    # 每個頁面對應一個 Vue 3 createApp 腳本
│           ├── index.js              # 首頁商品列表
│           ├── product-detail.js     # 商品詳情
│           ├── cart.js               # 購物車
│           ├── checkout.js           # 結帳表單
│           ├── login.js              # 登入 / 註冊雙 tab
│           ├── orders.js             # 我的訂單列表
│           ├── order-detail.js       # 訂單詳情 + 模擬付款
│           ├── admin-products.js     # 後台商品 CRUD
│           └── admin-orders.js       # 後台訂單列表與詳情
│
├── views/                            # EJS 模板
│   ├── layouts/
│   │   ├── front.ejs                 # 前台 layout：header + main + footer + Vue/auth/api scripts
│   │   └── admin.ejs                 # 後台 layout：sidebar + main，內含 Auth.requireAdmin() 守門
│   ├── partials/
│   │   ├── head.ejs                  # <head>：title、Google Fonts、output.css
│   │   ├── header.ejs                # 前台導覽列（含 #cart-badge、#auth-nav、#orders-link）
│   │   ├── admin-header.ejs          # 後台頂部欄
│   │   ├── admin-sidebar.ejs         # 後台側邊選單（依 currentPath 高亮）
│   │   ├── footer.ejs
│   │   └── notification.ejs          # Toast 容器 #notification-toast
│   └── pages/
│       ├── 404.ejs
│       ├── index.ejs                 # 商品列表 + featured banner
│       ├── product-detail.ejs        # 商品詳情，#app[data-product-id]
│       ├── cart.ejs                  # 購物車
│       ├── checkout.ejs              # 收件人表單
│       ├── login.ejs                 # 登入 / 註冊
│       ├── orders.ejs                # 訂單列表
│       ├── order-detail.ejs          # 訂單詳情，#app[data-order-id][data-payment-result]
│       └── admin/
│           ├── products.ejs          # 商品管理（含 Modal）
│           └── orders.ejs            # 訂單管理（含側拉詳情）
│
├── src/
│   ├── database.js                   # 唯一的 DB 模組：初始化、建表、seed
│   ├── middleware/
│   │   ├── authMiddleware.js         # 解 Bearer JWT → req.user
│   │   ├── adminMiddleware.js        # 檢查 req.user.role === 'admin'
│   │   ├── sessionMiddleware.js      # 讀取 X-Session-Id → req.sessionId（全域掛載）
│   │   └── errorHandler.js           # 統一錯誤回應；500 時隱藏細節
│   └── routes/
│       ├── authRoutes.js             # POST /register、/login；GET /profile
│       ├── productRoutes.js          # GET /、/:id（公開）
│       ├── cartRoutes.js             # GET/POST/PATCH/DELETE；內含 dualAuth
│       ├── orderRoutes.js            # POST 建立、GET 列表、GET 詳情、PATCH /:id/pay
│       ├── adminProductRoutes.js     # GET/POST/PUT/DELETE（authMiddleware + adminMiddleware）
│       ├── adminOrderRoutes.js       # GET 列表、GET 詳情（authMiddleware + adminMiddleware）
│       └── pageRoutes.js             # SSR 頁面路由（前台 + 後台），透過 renderFront/renderAdmin
│
└── tests/                            # Vitest 測試（每檔對應一條 API）
    ├── setup.js                      # 共用 import：app/request/getAdminToken/registerUser
    ├── auth.test.js
    ├── products.test.js
    ├── cart.test.js
    ├── orders.test.js
    ├── adminProducts.test.js
    └── adminOrders.test.js
```

---

## 啟動流程

1. **`npm start`** 執行 `css:build`（Tailwind 編譯到 `public/css/output.css`）後再 `node server.js`。
2. **`server.js`**
   1. `require('./app')` 觸發 app 組裝。
   2. 讀取 `process.env.PORT`，預設 `3001`。
   3. 若 `process.env.JWT_SECRET` 不存在 → `console.error` 後 `process.exit(1)`，伺服器不會啟動。
   4. `app.listen(PORT)`。
3. **`app.js`** 組裝順序（影響行為，請維持）：
   1. `require('dotenv').config()` — 先載入 `.env`。
   2. `require('./src/database')` — 觸發 DB 初始化（建表 + seed admin + seed 商品）。
   3. 設定 EJS view engine 與 `views` 目錄。
   4. `express.static('public')` 提供靜態檔。
   5. 全域中介：`cors`（origin 為 `FRONTEND_URL || 'http://localhost:3001'`）→ `express.json()` → `express.urlencoded()` → `sessionMiddleware`（將 `X-Session-Id` 寫入 `req.sessionId`）。
   6. 掛載 API 路由：`/api/auth`、`/api/admin/products`、`/api/admin/orders`、`/api/products`、`/api/cart`、`/api/orders`。**Admin 路由必須掛在 `/api/products`、`/api/orders` 之前**，避免被一般路由攔截（這是現行順序的關鍵原因）。
   7. 掛載頁面路由 `/`。
   8. 404 fallback：若路徑以 `/api` 開頭回 JSON；否則 render `pages/404.ejs` 套上 front layout。
   9. 最後接 `errorHandler`。
4. **`src/database.js`** 模組首次載入時執行 `initializeDatabase()`：
   - 打開 `database.sqlite`（不存在則建立）。
   - 啟用 `journal_mode = WAL`、`foreign_keys = ON`。
   - `CREATE TABLE IF NOT EXISTS` 建立 5 張表。
   - `seedAdminUser()`：若 admin email 尚未存在則插入。**測試環境（`NODE_ENV=test`）的 `saltRounds` 降為 1 以加速**。
   - `seedProducts()`：若 products 表為空則一次插入 8 筆 demo 商品。

---

## API 路由總覽

統一 base path：`/api/*`。所有 API 路由皆於 `app.js` 第 30–35 行掛載。

| Prefix | 檔案 | 認證 | 說明 |
| --- | --- | --- | --- |
| `/api/auth` | `src/routes/authRoutes.js` | 公開（`/profile` 需 JWT） | 註冊、登入、取得個人資料 |
| `/api/products` | `src/routes/productRoutes.js` | 公開 | 商品列表（含分頁）與詳情 |
| `/api/cart` | `src/routes/cartRoutes.js` | **dualAuth**（JWT 或 X-Session-Id） | 購物車 CRUD |
| `/api/orders` | `src/routes/orderRoutes.js` | JWT 必填（整個 router 套用 `authMiddleware`） | 建立訂單、列表、詳情、付款 |
| `/api/admin/products` | `src/routes/adminProductRoutes.js` | JWT + `role === 'admin'` | 後台商品 CRUD |
| `/api/admin/orders` | `src/routes/adminOrderRoutes.js` | JWT + `role === 'admin'` | 後台訂單列表與詳情 |

### 完整端點清單

| Method | Path | 認證 | 行為 |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | 無 | 註冊新使用者（自動回傳 JWT） |
| POST | `/api/auth/login` | 無 | 登入並回傳 JWT |
| GET | `/api/auth/profile` | JWT | 取得自己的資料 |
| GET | `/api/products` | 無 | 商品列表（query: `page`、`limit`） |
| GET | `/api/products/:id` | 無 | 商品詳情 |
| GET | `/api/cart` | dualAuth | 查看購物車 |
| POST | `/api/cart` | dualAuth | 加入商品 |
| PATCH | `/api/cart/:itemId` | dualAuth | 修改數量 |
| DELETE | `/api/cart/:itemId` | dualAuth | 移除項目 |
| POST | `/api/orders` | JWT | 從購物車建單（transaction：建單、扣庫存、清車） |
| GET | `/api/orders` | JWT | 自己的訂單列表 |
| GET | `/api/orders/:id` | JWT | 自己的訂單詳情 |
| PATCH | `/api/orders/:id/pay` | JWT | 模擬付款（body: `action: success\|fail`） |
| GET | `/api/admin/products` | Admin | 後台商品列表（分頁） |
| POST | `/api/admin/products` | Admin | 新增商品 |
| PUT | `/api/admin/products/:id` | Admin | 編輯商品（部分欄位） |
| DELETE | `/api/admin/products/:id` | Admin | 刪除商品（若有 pending 訂單則 409） |
| GET | `/api/admin/orders` | Admin | 後台訂單列表（query: `page`、`limit`、`status`） |
| GET | `/api/admin/orders/:id` | Admin | 後台訂單詳情（含買家 user 資訊） |

### SSR 頁面路由（pageRoutes.js）

| Path | View | 備註 |
| --- | --- | --- |
| `/` | `pages/index.ejs` | 商品列表 |
| `/products/:id` | `pages/product-detail.ejs` | 帶入 `productId` 至 `#app[data-product-id]` |
| `/cart` | `pages/cart.ejs` | |
| `/checkout` | `pages/checkout.ejs` | 客戶端 `Auth.requireAuth()` 守門 |
| `/login` | `pages/login.ejs` | 含登入/註冊雙 tab |
| `/orders` | `pages/orders.ejs` | 客戶端 `Auth.requireAuth()` 守門 |
| `/orders/:id` | `pages/order-detail.ejs` | 帶入 `orderId` 與 `paymentResult`（query `?payment=...`） |
| `/admin/products` | `pages/admin/products.ejs` | admin layout 內以 `Auth.requireAdmin()` 守門 |
| `/admin/orders` | `pages/admin/orders.ejs` | 同上 |

非 `/api/*` 路徑若未匹配 → render `pages/404.ejs`。

---

## 統一回應格式

所有 `/api/*` 端點皆回傳：

```json
{
  "data": <any | null>,
  "error": <string | null>,
  "message": "<人類可讀訊息>"
}
```

- 成功：`error: null`，`data` 為實際 payload。
- 失敗：`data: null`，`error` 為錯誤代碼字串，`message` 為提示訊息。

### 範例

**成功**：
```json
{
  "data": { "user": { "id": "...", "email": "...", "name": "...", "role": "user" }, "token": "..." },
  "error": null,
  "message": "登入成功"
}
```

**失敗（驗證錯誤）**：
```json
{
  "data": null,
  "error": "VALIDATION_ERROR",
  "message": "email、password、name 為必填欄位"
}
```

**失敗（未授權）**：
```json
{
  "data": null,
  "error": "UNAUTHORIZED",
  "message": "請先登入"
}
```

### 錯誤碼一覽（出現在程式中的字串）

| Error code | HTTP | 出現位置 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | 欄位驗證失敗 |
| `STOCK_INSUFFICIENT` | 400 | 加入購物車 / 結帳時庫存不足 |
| `CART_EMPTY` | 400 | 結帳時購物車為空 |
| `INVALID_STATUS` | 400 | 訂單付款時狀態非 pending |
| `UNAUTHORIZED` | 401 | 未提供 token / token 過期 / 使用者不存在 / X-Session-Id 也缺 |
| `FORBIDDEN` | 403 | adminMiddleware 拒絕 |
| `NOT_FOUND` | 404 | 商品、訂單、購物車項目、使用者不存在；404 fallback |
| `CONFLICT` | 409 | Email 已存在；刪除商品時有未完成訂單 |
| `INTERNAL_ERROR` | 500 | errorHandler 兜底（訊息會被替換為「伺服器內部錯誤」） |

---

## 認證與授權機制

本專案有三套並行的認證模式：

### 1. JWT（標準）

- **產生點**：`POST /api/auth/register` 與 `POST /api/auth/login` 回傳 token。
- **Payload**：`{ userId, email, role }`。
- **演算法**：`HS256`（強制驗證 `algorithms: ['HS256']`，避免 `alg: none` 攻擊）。
- **Secret**：`process.env.JWT_SECRET`，缺失伺服器拒絕啟動。
- **有效期**：`7d`。
- **發送方式**：`Authorization: Bearer <token>`。
- **驗證流程**（`src/middleware/authMiddleware.js`）：
  1. 檢查 `Authorization` header 是否存在且為 `Bearer ...`，否則 401。
  2. `jwt.verify` token 與 secret，失敗 → 401「Token 無效或已過期」。
  3. 用 `decoded.userId` 查 DB，使用者不存在 → 401（防止刪號後 token 仍有效）。
  4. 寫入 `req.user = { userId, email, role }`。

### 2. Admin 角色檢查

- **檔案**：`src/middleware/adminMiddleware.js`。
- **規則**：`req.user.role !== 'admin'` → 403。
- **使用方式**：必須**先** `authMiddleware` 再 `adminMiddleware`。`src/routes/adminProductRoutes.js` 與 `adminOrderRoutes.js` 各自於最上方執行 `router.use(authMiddleware, adminMiddleware)`，故 router 內所有 handler 都受保護。

### 3. X-Session-Id（訪客購物車專用）

- **檔案**：`src/middleware/sessionMiddleware.js`（全域掛載於 `app.js`）。
- **行為**：若 header 有 `X-Session-Id` 則寫入 `req.sessionId`；否則 noop。
- **使用點**：僅 `cartRoutes.js` 的 `dualAuth` 函式會去用 `req.sessionId`。

### 雙模式認證（dualAuth，僅 `/api/cart`）

`cartRoutes.js` 內定義 `dualAuth(req, res, next)`：

1. 若 `Authorization` header 存在且以 `Bearer ` 起頭：
   - 嘗試 `jwt.verify`。成功 → 寫入 `req.user`、`next()`。
   - **驗證失敗 → 立即 401（不 fallback 到 session）**：因為使用者明確提供了 token，若無效視為錯誤狀態。
2. 否則檢查 `req.sessionId`，有則 `next()`（訪客模式）。
3. 兩者皆無 → 401「請提供有效的登入 Token 或 X-Session-Id」。

### 購物車擁有者判定（getOwnerCondition）

```js
if (req.user) → { field: 'user_id', value: req.user.userId }
else          → { field: 'session_id', value: req.sessionId }
```

此函式被 `cartRoutes.js` 所有 handler 共用，所有 cart 查詢都會用對應的欄位做 WHERE 篩選。**目前未實作「登入後合併訪客購物車」的功能**——若使用者先以 session 加入購物車後再登入，舊資料會留在 session_id 列。

### 前端 Auth 行為

前端 `public/js/auth.js` 提供 `Auth` 全域物件：
- 將 token、user JSON、session id 存於 `localStorage`（key 為 `flower_token` / `flower_user` / `flower_session_id`）。
- `getAuthHeaders()` 會**同時**帶上 `Authorization` 與 `X-Session-Id`，因此 cart API 永遠收得到 session id，但只要登入後就會以 JWT 為準。
- `requireAuth()` / `requireAdmin()` 在頁面腳本中作為前置 redirect 守門。

`public/js/api.js` 的 `apiFetch()` 若收到 401：清除 localStorage 中的 token/user 後強制 redirect 至 `/login`。

---

## 資料庫 Schema

SQLite，5 張表，全部在 `src/database.js` 的 `initializeDatabase()` 中建立。所有主鍵採用 `uuidv4()` 產生的字串。所有 `created_at` / `updated_at` 預設為 SQLite `datetime('now')` UTC。

### `users`

| 欄位 | 型別 | 約束 | 說明 |
| --- | --- | --- | --- |
| `id` | TEXT | PRIMARY KEY | uuid v4 |
| `email` | TEXT | UNIQUE, NOT NULL | 註冊 email |
| `password_hash` | TEXT | NOT NULL | bcrypt hash，`saltRounds=10`（測試環境 1） |
| `name` | TEXT | NOT NULL | 顯示名稱 |
| `role` | TEXT | NOT NULL DEFAULT `'user'`，CHECK `IN ('user','admin')` | 權限 |
| `created_at` | TEXT | NOT NULL DEFAULT `datetime('now')` | UTC ISO |

### `products`

| 欄位 | 型別 | 約束 | 說明 |
| --- | --- | --- | --- |
| `id` | TEXT | PRIMARY KEY | uuid v4 |
| `name` | TEXT | NOT NULL | 商品名稱 |
| `description` | TEXT | — | 描述（可空） |
| `price` | INTEGER | NOT NULL, CHECK `price > 0` | 單位：NTD 元，整數 |
| `stock` | INTEGER | NOT NULL DEFAULT 0, CHECK `stock >= 0` | 庫存量 |
| `image_url` | TEXT | — | 圖片 URL |
| `created_at` | TEXT | NOT NULL DEFAULT `datetime('now')` | |
| `updated_at` | TEXT | NOT NULL DEFAULT `datetime('now')` | 更新時須手動 `SET updated_at = datetime('now')` |

### `cart_items`

| 欄位 | 型別 | 約束 | 說明 |
| --- | --- | --- | --- |
| `id` | TEXT | PRIMARY KEY | uuid v4 |
| `session_id` | TEXT | — | 訪客模式擁有者；登入模式時為 NULL |
| `user_id` | TEXT | FOREIGN KEY → `users.id` | 登入模式擁有者；訪客時為 NULL |
| `product_id` | TEXT | NOT NULL, FOREIGN KEY → `products.id` | |
| `quantity` | INTEGER | NOT NULL DEFAULT 1, CHECK `quantity > 0` | |

注意：`session_id` 與 `user_id` 互斥（程式邏輯保證，但 schema 未強制）。

### `orders`

| 欄位 | 型別 | 約束 | 說明 |
| --- | --- | --- | --- |
| `id` | TEXT | PRIMARY KEY | uuid v4 |
| `order_no` | TEXT | UNIQUE NOT NULL | 格式 `ORD-YYYYMMDD-XXXXX`，XXXXX 為 uuid 前 5 字大寫 |
| `user_id` | TEXT | NOT NULL, FOREIGN KEY → `users.id` | 下單者 |
| `recipient_name` | TEXT | NOT NULL | 收件人 |
| `recipient_email` | TEXT | NOT NULL | 收件信箱 |
| `recipient_address` | TEXT | NOT NULL | 收件地址 |
| `total_amount` | INTEGER | NOT NULL | 訂單總額（NTD） |
| `status` | TEXT | NOT NULL DEFAULT `'pending'`，CHECK `IN ('pending','paid','failed')` | 付款狀態 |
| `created_at` | TEXT | NOT NULL DEFAULT `datetime('now')` | |

### `order_items`

| 欄位 | 型別 | 約束 | 說明 |
| --- | --- | --- | --- |
| `id` | TEXT | PRIMARY KEY | uuid v4 |
| `order_id` | TEXT | NOT NULL, FOREIGN KEY → `orders.id` | |
| `product_id` | TEXT | NOT NULL | （冗餘保留，未設 FK） |
| `product_name` | TEXT | NOT NULL | 下單當下的名稱快照 |
| `product_price` | INTEGER | NOT NULL | 下單當下的單價快照 |
| `quantity` | INTEGER | NOT NULL | |

**設計重點**：訂單品項的 `product_name` 與 `product_price` 為快照欄位，即使後台修改了商品名稱或價格，歷史訂單仍顯示購買當下的資料。

### Schema ER 摘要

```
users 1 ──< orders 1 ──< order_items >── (product_id 冗餘)
                                          
users 1 ──< cart_items >── products
session 1 ─< cart_items
```

---

## 資料流（關鍵流程）

### 訪客加入購物車 → 登入後結帳

1. 前端 `Auth.getSessionId()` 首次呼叫時用 `crypto.randomUUID()` 產生並存於 localStorage。
2. 所有 `apiFetch` 都會帶 `X-Session-Id`（同時若有 token 也帶 Bearer）。
3. 訪客時 cart 寫入以 `session_id` 為擁有者。
4. 使用者登入後，前端不會自動搬移 cart；新加入的商品改寫入 `user_id` 列。**舊 session 列仍存在**（目前無清理機制）。
5. 結帳 `/api/orders` 強制 `authMiddleware`，只讀取 `WHERE user_id = ?` 的 cart 列。

### 建立訂單的 transaction（`POST /api/orders`）

`createOrder` 包在 `db.transaction(() => { ... })` 內，依序：

1. `INSERT INTO orders ...`
2. 對每個 cart item：`INSERT INTO order_items ...`（含 product 名稱與價格快照） + `UPDATE products SET stock = stock - ?`。
3. `DELETE FROM cart_items WHERE user_id = ?`。

若任一步拋錯，整個交易回滾。庫存檢查在 transaction 之前已執行；但下單瞬間有 race condition 可能（兩個並行請求同時通過庫存檢查）。CHECK `stock >= 0` 會在 UPDATE 觸發約束失敗時讓 transaction 回滾。

### 模擬付款（`PATCH /api/orders/:id/pay`）

- Body：`{ "action": "success" | "fail" }`。
- 對應 status：`success → paid`、`fail → failed`。
- 必須是 `pending` 才能轉換，否則 400 `INVALID_STATUS`。
- 沒有真實金流串接；`.env` 雖然有 `ECPAY_*` 變數但目前程式碼未使用。

---

## 金流／第三方整合

**現況：未整合任何真實金流**。

- `.env.example` 保留 `ECPAY_MERCHANT_ID`、`ECPAY_HASH_KEY`、`ECPAY_HASH_IV`、`ECPAY_ENV=staging` 四個變數，但搜尋整個 codebase 並未引用。
- 付款流程僅為前端「成功 / 失敗」按鈕呼叫 `PATCH /api/orders/:id/pay` 後台更新 status，無外部呼叫、無回調 URL、無簽章驗證。
- 若未來要接 ECPay：建議於 `src/services/ecpay.js`（自建）封裝 SDK 呼叫，並新增 callback route（注意 `errorHandler` 對 500 會吞訊息，callback 失敗除錯時需臨時開 console log 或加 `isOperational`）。
