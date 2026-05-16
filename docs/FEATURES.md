# 功能清單與行為描述

每個功能區塊包含「行為描述」「請求/查詢欄位」「業務邏輯」「錯誤情境」。✅ 表示已實作並通過測試。

---

## 1. 認證（Auth）— ✅

對應檔案：`src/routes/authRoutes.js`、`src/middleware/authMiddleware.js`

### 1.1 註冊 `POST /api/auth/register`

**行為**：建立新使用者並直接回傳 JWT（不需要二段驗證）。新使用者 role 一律為 `user`。

**Body（必填）**：
| 欄位 | 型別 | 規則 |
| --- | --- | --- |
| `email` | string | 必填；regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| `password` | string | 必填；長度 ≥ 6 |
| `name` | string | 必填 |

**業務邏輯**：
1. 三個欄位缺一 → 400 `VALIDATION_ERROR`「email、password、name 為必填欄位」。
2. Email 格式錯 → 400「Email 格式不正確」。
3. 密碼長度 < 6 → 400「密碼至少需要 6 個字元」。
4. Email 已存在 → 409 `CONFLICT`「Email 已被註冊」。
5. `bcrypt.hashSync(password, 10)` 雜湊存庫。
6. `jwt.sign({ userId, email, role }, JWT_SECRET, { expiresIn: '7d' })` 簽 token。
7. 回 201，`data.user = { id, email, name, role }`、`data.token = '<jwt>'`。

### 1.2 登入 `POST /api/auth/login`

**Body**：`{ email, password }` 兩者必填。

**業務邏輯**：
1. 缺欄位 → 400 `VALIDATION_ERROR`。
2. 找不到使用者 → 401 `UNAUTHORIZED`「Email 或密碼錯誤」。
3. `bcrypt.compareSync` 失敗 → 同樣 401 同樣訊息（避免 user enumeration）。
4. 成功簽發 token，回 200。

### 1.3 取得個人資料 `GET /api/auth/profile` — JWT

**業務邏輯**：經 `authMiddleware` 解 token 後，以 `req.user.userId` 查 `users` 表回傳 `{ id, email, name, role, created_at }`。使用者被刪除則 404（理論上 middleware 已先擋下，仍保險檢查）。

---

## 2. 商品（Products）— ✅

對應檔案：`src/routes/productRoutes.js`

### 2.1 商品列表 `GET /api/products`

**Query 參數**：
| 參數 | 預設 | 限制 |
| --- | --- | --- |
| `page` | `1` | `Math.max(1, parseInt(page))`；NaN → 1 |
| `limit` | `10` | `Math.max(1, Math.min(100, parseInt(limit)))`；最大 100 |

**回應**：
```json
{
  "data": {
    "products": [ { id, name, description, price, stock, image_url, created_at, updated_at } ],
    "pagination": { "total": <int>, "page": <int>, "limit": <int>, "totalPages": <int> }
  },
  "error": null,
  "message": "成功"
}
```

**業務邏輯**：`ORDER BY created_at DESC`，OFFSET / LIMIT 分頁。`totalPages = Math.ceil(total / limit)`。

### 2.2 商品詳情 `GET /api/products/:id`

- 找不到 → 404 `NOT_FOUND`「商品不存在」。
- 找到回 200，`data` 為單一商品物件。

---

## 3. 購物車（Cart，雙模式）— ✅

對應檔案：`src/routes/cartRoutes.js`

**認證機制**：`dualAuth`（見 ARCHITECTURE.md）。重點：
- 若帶 `Authorization: Bearer <token>` → 驗證 JWT，失敗**不 fallback** 至 session，直接 401。
- 否則需有 `X-Session-Id` header。
- 擁有者欄位由 `getOwnerCondition(req)` 決定：登入用 `user_id`，訪客用 `session_id`。
- **未實作合併**：登入前/後的購物車不會自動合併。

### 3.1 查看購物車 `GET /api/cart`

**回應 data**：
```json
{
  "items": [ { id, product_id, quantity, product: { name, price, stock, image_url } } ],
  "total": <int>  // sum of price * quantity
}
```

`total` 在 server 端計算（非從 DB 直接取）。

### 3.2 加入購物車 `POST /api/cart`

**Body**：
| 欄位 | 型別 | 規則 |
| --- | --- | --- |
| `productId` | string | 必填 |
| `quantity` | integer | 預設 1；必須為正整數 |

**業務邏輯**（累加機制）：
1. `productId` 缺 → 400 `VALIDATION_ERROR`「productId 為必填欄位」。
2. `quantity` 非正整數 → 400「quantity 必須為正整數」。
3. 商品不存在 → 404 `NOT_FOUND`。
4. 若該擁有者已有該商品在車內：
   - 新數量 = 既有數量 + 本次 quantity。
   - 若 > 庫存 → 400 `STOCK_INSUFFICIENT`「庫存不足」。
   - 否則 UPDATE 既有 row。
5. 若該擁有者無該商品在車內：
   - 若 quantity > 庫存 → 400 `STOCK_INSUFFICIENT`。
   - INSERT 新 row。
6. 回 200，`data = { id, product_id, quantity: <最終數量> }`。

**注意**：庫存檢查只在加入時做，未來商品被改庫存後購物車不會自動清除超量項。

### 3.3 修改數量 `PATCH /api/cart/:itemId`

**Body**：`{ "quantity": <positive int> }`。
- `quantity` 非正整數 → 400。
- 項目不存在（依擁有者 WHERE 篩選）→ 404。
- 新數量 > 商品庫存 → 400 `STOCK_INSUFFICIENT`。
- 成功 → 200，回更新後的 `{ id, product_id, quantity }`。

### 3.4 移除項目 `DELETE /api/cart/:itemId`

- 項目不存在 → 404。
- 成功 → 200，`data: null`，`message: '已從購物車移除'`。

---

## 4. 訂單（Orders，使用者）— ✅

對應檔案：`src/routes/orderRoutes.js`、`src/services/ecpay.js`、`src/routes/paymentRoutes.js`

整個 `/api/orders` router 套用 `authMiddleware`（`router.use(authMiddleware)`），所有端點必須帶 JWT。
ECPay 公開路由（`/payment/*`、`/ecpay/notify`）在 `paymentRoutes.js` 內定義，不經 `authMiddleware`，但內部呼叫的 `/api/orders/:id/ecpay-checkout` 與 `/api/orders/:id/ecpay-query` 仍需 JWT，由前端從 localStorage 補上 `Authorization` header。

### 4.1 建立訂單 `POST /api/orders`

**Body**：
| 欄位 | 型別 | 規則 |
| --- | --- | --- |
| `recipientName` | string | 必填 |
| `recipientEmail` | string | 必填，須符合 email regex |
| `recipientAddress` | string | 必填 |

**業務邏輯**（核心：transaction）：
1. 任一收件欄位缺 → 400 `VALIDATION_ERROR`。
2. Email 格式錯 → 400「Email 格式不正確」。
3. 撈取登入者的 `cart_items` JOIN `products`，含 `product_stock`。
4. 購物車為空 → 400 `CART_EMPTY`「購物車為空」。
5. 任何 item.quantity > product_stock → 400 `STOCK_INSUFFICIENT`，訊息列出所有不足商品名稱（以 `, ` 連接）。
6. 計算 `totalAmount = Σ(product_price * quantity)`。
7. 產生 `order_no`：`ORD-YYYYMMDD-XXXXX`，YYYYMMDD 為當下 UTC 日期，XXXXX 為 uuid 前 5 字大寫。
8. **`db.transaction(...)` 內**依序執行：
   - INSERT `orders`（含收件人欄位、total_amount、status='pending'）。
   - 對每個 cart item：INSERT `order_items`（含 product_name、product_price 快照）+ `UPDATE products SET stock = stock - ?`。
   - `DELETE FROM cart_items WHERE user_id = ?` 清空該使用者的車。
9. Transaction 完成後再 SELECT 回傳。
10. 回 201，`data = { id, order_no, total_amount, status, items: [{ product_name, product_price, quantity }], created_at }`。

**並行風險**：庫存檢查與 UPDATE 之間無 lock；但 `stock >= 0` CHECK 約束會在 UPDATE 觸發失敗時讓 transaction 回滾。

### 4.2 自己的訂單列表 `GET /api/orders`

**業務邏輯**：`SELECT id, order_no, total_amount, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC`。

回 `data: { orders: [...] }`。**不含分頁**。

### 4.3 訂單詳情 `GET /api/orders/:id`

- `WHERE id = ? AND user_id = ?`（防止跨使用者查看）；找不到 → 404。
- 帶上 `order_items` 全部欄位。
- 不含 user 物件（後台才有）。

### 4.4 模擬付款 `PATCH /api/orders/:id/pay`

**Body**：`{ "action": "success" | "fail" }`。

**業務邏輯**：
1. action 不在 `success` / `fail` → 400 `VALIDATION_ERROR`「action 必須為 success 或 fail」。
2. 訂單不屬於該使用者 → 404 `NOT_FOUND`。
3. 訂單 `status !== 'pending'` → 400 `INVALID_STATUS`「訂單狀態不是 pending，無法付款」。
4. `actionMap = { success: 'paid', fail: 'failed' }`；UPDATE status。
5. 回 200，`data = { ...訂單, items: [...] }`；`message` 為「付款成功」或「付款失敗」。

**目前狀態**：**前台已不再呼叫此 API**（checkout 完成後改為導向 `/payment/ecpay/:id` 走真實綠界流程）。此端點保留主要是為了：
- `tests/orders.test.js` 仍依賴它測試訂單狀態轉換。
- 後台或開發環境需要手動把訂單翻牌時可用。

### 4.5 產生綠界 ECPay 付款參數 `POST /api/orders/:id/ecpay-checkout`

**行為**：產生跳轉至綠界 AIO 付款頁所需的 form 參數（含 `CheckMacValue`），並回傳目標 URL 與 method，由前端組成 hidden form 後 submit 至綠界。

**前置條件**：
- 訂單必須屬於登入使用者，否則 404 `NOT_FOUND`。
- 訂單 `status` 必須為 `pending`，否則 400 `INVALID_STATUS`「訂單狀態不是 pending，無法重新付款」。

**業務邏輯**：
1. 以 `crypto.randomBytes(4)` 產生新的 `MerchantTradeNo`（格式 `EC<13 位毫秒時間戳><8 位 hex>`，截長至 ≤ 20 字元、純英數字），覆寫 `orders.ecpay_trade_no`。**MerchantTradeNo 永久唯一**，所以重試付款必須產生新值。
2. 透過 `src/services/ecpay.js` 的 `buildAioCheckoutParams` 組出 AIO 參數，固定 `ChoosePayment=Credit`、`EncryptType=1`。`ItemName` 以 `<商品名> x<數量>` 並以 `#` 串接，做過控制字元與 `<>` 過濾，並截長至 200 字元。
3. `ReturnURL` 帶入 `<BASE_URL>/api/orders/ecpay/notify`；`OrderResultURL` 帶入 `<BASE_URL>/payment/return/:id`；`ClientBackURL` 帶入 `<BASE_URL>/orders/:id?payment=cancel`。`BASE_URL` 取自 `process.env.BASE_URL`，缺時 fallback 為當前請求的 `protocol://host`。
4. 計算 `CheckMacValue`（SHA256 + `ecpayUrlEncode`：urlencode → toLowerCase → .NET 字元還原），附在參數最後。

**回應 data**：
```json
{
  "action": "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
  "method": "POST",
  "params": {
    "MerchantID": "...",
    "MerchantTradeNo": "EC...",
    "MerchantTradeDate": "2026/05/15 17:30:00",
    "PaymentType": "aio",
    "TotalAmount": 1680,
    "TradeDesc": "Flower Life 訂單付款",
    "ItemName": "粉色玫瑰花束 x1",
    "ReturnURL": "...",
    "ChoosePayment": "Credit",
    "EncryptType": 1,
    "OrderResultURL": "...",
    "ClientBackURL": "...",
    "CheckMacValue": "..."
  }
}
```

**前端流程**：`/payment/ecpay/:id` 頁面載入後呼叫此 API → 把 `params` 全部寫入 hidden input → `form.submit()` 跳轉到綠界。

### 4.6 主動查詢綠界付款結果 `POST /api/orders/:id/ecpay-query`

**行為**：本地端主動呼叫綠界 `QueryTradeInfo/V5` 取得最新付款狀態並冪等更新訂單。**本機環境收不到 Server Notify，這是付款結果確認的唯一來源**。

**前置條件**：
- 訂單必須屬於登入使用者，否則 404 `NOT_FOUND`。
- 訂單 `ecpay_trade_no` 必須有值（曾經呼叫過 `ecpay-checkout`），否則 400 `NO_ECPAY_TRADE`「此訂單尚未發起綠界付款」。

**業務邏輯**：
1. 用 `ecpay_trade_no` 作為 `MerchantTradeNo`，加上 Unix 秒級 `TimeStamp`（**3 分鐘有效期**，每次呼叫重新產生）與 `CheckMacValue`，以 `Content-Type: application/x-www-form-urlencoded` POST 到 `/Cashier/QueryTradeInfo/V5`。
2. 解析綠界回傳的 URL-encoded 字串，使用 `crypto.timingSafeEqual` 驗證 `CheckMacValue`，驗章失敗 → 502「綠界查詢回應驗章失敗」。
3. 依 `TradeStatus` 決定後續：
   - `1`（已付款）：**先驗證 `TradeAmt === orders.total_amount`**，金額不符 → 502 `AMOUNT_MISMATCH`「綠界回傳金額與訂單金額不符」。通過則 status 轉為 `paid`。
   - `10200095`（交易未成立）：status 轉為 `failed`。
   - `0`（未付款）／`10200047`（訂單不存在於綠界）／其他：**不變動訂單 status**，僅返回查詢結果讓前端顯示「尚未確認」訊息。
4. 若狀態有變動或 `TradeNo` 不同，UPDATE 訂單：寫入 `status`、`ecpay_tx_no`（綠界端 TradeNo）、`payment_method`（PaymentType，如 `Credit_CreditCard`）、`paid_at`（綠界回傳的 `PaymentDate`）。
5. **冪等保證**：同一筆訂單重複查詢，只要 TradeStatus 不變且 TradeNo 不變，就不會重複寫入；庫存在建單時已扣，付款結果不會再動庫存。

**回應 data**：
```json
{
  "order": { ...完整訂單欄位含 ecpay_trade_no/ecpay_tx_no/payment_method/paid_at },
  "ecpay": {
    "MerchantTradeNo": "EC...",
    "TradeNo": "230615000000123",
    "TradeStatus": "1",
    "PaymentType": "Credit_CreditCard",
    "PaymentDate": "2026/05/15 17:35:21",
    "TradeAmt": 1680
  }
}
```

**錯誤情境**：
- 502「無法連線到綠界查詢服務」：fetch 失敗（網路問題）。
- 502「綠界查詢服務回應 HTTP <code>」：綠界回非 2xx。
- 502「綠界查詢回應驗章失敗」：CheckMacValue 不符（可能 HashKey/HashIV 錯誤或回應遭竄改）。
- 502 `AMOUNT_MISMATCH`：金額遭竄改。
- 400 `NO_ECPAY_TRADE`：訂單尚未走過 `ecpay-checkout`。

**安全提醒**：CheckMacValue 比對使用 `crypto.timingSafeEqual` 而非 `===`，避免 timing attack。`HashKey` / `HashIV` 從環境變數讀取，**絕對不可寫入前端或版本控制**。

---

## 5. 後台商品管理（Admin Products）— ✅

對應檔案：`src/routes/adminProductRoutes.js`

整個 router 套用 `authMiddleware + adminMiddleware`，必須是 admin 才能存取。一般使用者得 403 `FORBIDDEN`，未登入得 401。

### 5.1 後台商品列表 `GET /api/admin/products`

與前台 `GET /api/products` 相同分頁邏輯（page、limit），回傳 `{ products, pagination }`。當前實作**未顯示停售/隱藏狀態**——目前 products 表沒有 `is_active` 欄位。

### 5.2 新增商品 `POST /api/admin/products`

**Body**：
| 欄位 | 型別 | 規則 |
| --- | --- | --- |
| `name` | string | 必填 |
| `description` | string | 選填，未提供存 NULL |
| `price` | integer | 必填，正整數 |
| `stock` | integer | 必填，非負整數 |
| `image_url` | string | 選填，未提供存 NULL |

驗證錯誤一律 400 `VALIDATION_ERROR`。成功 201 回完整商品物件。

### 5.3 編輯商品 `PUT /api/admin/products/:id`

**Body**：所有欄位皆為**可選**（PATCH-like PUT）；未提供的欄位保留既值。
- 若提供了 `name` 但 trim 後為空 → 400「商品名稱不能為空」。
- `price` 若提供必須為正整數，`stock` 若提供必須為非負整數。
- 不存在 → 404。
- 成功 UPDATE 並手動 `SET updated_at = datetime('now')`。回 200。

### 5.4 刪除商品 `DELETE /api/admin/products/:id`

**業務邏輯**：
1. 商品不存在 → 404。
2. **檢查是否有 pending 訂單包含此商品**（`order_items JOIN orders WHERE product_id = ? AND status = 'pending'`）。
3. 有任何 pending 訂單 → 409 `CONFLICT`「此商品存在未完成的訂單，無法刪除」。
4. 否則 `DELETE FROM products WHERE id = ?`。回 200，`data: null`。

**注意**：刪除商品不會自動清理 `cart_items` 中參照的 row，這些列在下次查購物車時會因 INNER JOIN 而消失但留在資料庫。

---

## 6. 後台訂單管理（Admin Orders）— ✅

對應檔案：`src/routes/adminOrderRoutes.js`

router 套用 `authMiddleware + adminMiddleware`。

### 6.1 後台訂單列表 `GET /api/admin/orders`

**Query 參數**：
| 參數 | 預設 | 規則 |
| --- | --- | --- |
| `page` | 1 | 同 product 列表 |
| `limit` | 10 | 最大 100 |
| `status` | 無 | 必須是 `pending`、`paid`、`failed` 三者之一才生效；其他值會被忽略，回所有訂單 |

`ORDER BY created_at DESC`，回 `{ orders, pagination }`。

每筆 order 包含所有欄位（id, order_no, user_id, recipient_*, total_amount, status, created_at），但**不含 items 也不含 user 名稱**。

### 6.2 後台訂單詳情 `GET /api/admin/orders/:id`

- 找不到 → 404。
- 回 `{ ...order, items: [...], user: { name, email } | null }`。
- 與使用者版差異：可看任意 user 的訂單；額外帶 `user` 物件。

---

## 7. SSR 頁面（前台）— ✅

對應檔案：`src/routes/pageRoutes.js`、`views/pages/*.ejs`、`public/js/pages/*.js`

每個頁面都搭配一個對應的 Vue 3 createApp 腳本，URL → EJS → pageScript 之間的對應在 `pageRoutes.js`。

| 路徑 | View | pageScript | 行為摘要 |
| --- | --- | --- | --- |
| `/` | `index.ejs` | `index.js` | 載 `GET /api/products?page=1&limit=9`；加入購物車按鈕顯示 spinner 直到 API 完成 |
| `/products/:id` | `product-detail.ejs` | `product-detail.js` | 由 `#app[data-product-id]` 取得 id；數量受 stock 限制 |
| `/cart` | `cart.ejs` | `cart.js` | 數量變化即時呼叫 PATCH；刪除前彈確認對話框 |
| `/checkout` | `checkout.ejs` | `checkout.js` | `Auth.requireAuth()` 守門；若購物車為空自動 redirect 回 `/cart` |
| `/login` | `login.ejs` | `login.js` | 登入/註冊雙 tab；登入後依 `?redirect=` 導回原頁，否則回首頁 |
| `/orders` | `orders.ejs` | `orders.js` | 列出自己訂單，三色 status badge |
| `/orders/:id` | `order-detail.ejs` | `order-detail.js` | 顯示明細；pending 訂單顯示「前往綠界付款」與「主動向綠界查詢付款結果」兩顆按鈕；`?payment=success/failed/cancel/pending` 會顯示對應條幅；若狀態仍是 pending 且帶有 `?payment=` 參數（從綠界導回的情境），會自動觸發一次主動查詢 |
| `/payment/ecpay/:id` | （server-render） | — | 載入後 fetch `/api/orders/:id/ecpay-checkout` 取得 AIO 參數，組 hidden form 自動 submit 跳轉至綠界付款頁；未登入導去 `/login` |
| `/payment/return/:id` | （server-render） | — | 綠界 OrderResultURL 落地頁，顯示「處理中…」並立刻 POST `/api/orders/:id/ecpay-query`，依結果 redirect 回 `/orders/:id?payment=success\|failed\|pending` |

### 前端共用機制

- `Auth`（`public/js/auth.js`）：localStorage 管理 token、user、sessionId。
- `apiFetch`（`public/js/api.js`）：自動帶 `Authorization` 與 `X-Session-Id` header；遇 401 清登入並導去 `/login`。
- `Notification.show(msg, type)`：右上 toast，type 為 `success | error | warning | info`。
- `header-init.js`：DOMContentLoaded 時動態渲染導覽列右側（登入按鈕 / 使用者名稱 / 後台連結）、購物車徽章數字、訂單連結顯示。

---

## 8. SSR 頁面（後台）— ✅

對應檔案：`src/routes/pageRoutes.js`、`views/pages/admin/*.ejs`、`views/layouts/admin.ejs`、`public/js/pages/admin-*.js`

**守門邏輯位於 layout**：`views/layouts/admin.ejs` 內 inline script 執行 `Auth.requireAdmin()`，非 admin 直接 redirect 至 `/login`。**前端守門僅為 UX，API 仍由 `adminMiddleware` 把關。**

| 路徑 | View | pageScript | 行為摘要 |
| --- | --- | --- | --- |
| `/admin/products` | `admin/products.ejs` | `admin-products.js` | 表格 + 新增/編輯 Modal；刪除前彈確認 |
| `/admin/orders` | `admin/orders.ejs` | `admin-orders.js` | 表格 + status 篩選下拉；點 row 開側拉詳情面板 |

Sidebar (`views/partials/admin-sidebar.ejs`) 透過 `currentPath` locals（由 pageRoutes 傳入）決定哪項高亮。

---

## 9. 錯誤處理（全域）— ✅

對應檔案：`src/middleware/errorHandler.js`

**行為**：
- 從 `err.status || err.statusCode || 500` 推算 HTTP 狀態。
- **500 一律回傳「伺服器內部錯誤」**，不洩漏內部訊息（仍會 `console.error`）。
- 4xx：若 `err.isOperational === true` 則回 `err.message`；否則回 `SAFE_MESSAGES[statusCode]` 對照表中的中文：
  - 400 「請求格式錯誤」
  - 401 「未授權的請求」
  - 403 「禁止存取」
  - 404 「找不到該資源」
  - 409 「資源衝突」
  - 422 「無法處理的請求」
  - 429 「請求過於頻繁」
- `error` 欄位一律寫成 `'INTERNAL_ERROR'`（即使非 500）；錯誤碼差異主要靠 handler 自己 `res.json` 時就帶上具體 code，所以**走到 errorHandler 通常表示 unexpected 例外**。

**建議**：常規驗證錯誤、業務邏輯錯誤都應該由 handler 直接 `res.status(...).json(...)` 處理，不要靠 throw → errorHandler。

---

## 10. 待辦／未完成

下列為已知未實作但可能會被預期的功能：

- ❌ **登入後合併訪客購物車**：登入時不會把 `session_id` 列搬到 `user_id`。
- ✅ **真實金流（ECPay）整合**：已於 2026-05-15 完成。採綠界 AIO（信用卡）+ 本地主動查詢模式，見 §4.5 / §4.6。**未支援**：ATM／超商代碼／條碼（離線付款）、DoAction 退款、對帳檔下載。
- ❌ **商品的 is_active / 上下架**：products 表無此欄位，刪除是唯一隱藏方式。
- ❌ **使用者忘記密碼/重設密碼**。
- ❌ **訂單取消**：使用者無 API 取消；admin 也無更新狀態 API。
- ❌ **後台使用者管理**。
- ❌ **商品分類 / 標籤 / 搜尋 / 排序**：列表只能依 `created_at DESC` 分頁。
- ❌ **Rate limit**：errorHandler 雖有 429 的 SAFE_MESSAGES 但無 middleware 實作。
