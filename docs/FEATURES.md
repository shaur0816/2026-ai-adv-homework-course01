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

對應檔案：`src/routes/orderRoutes.js`

整個 router 套用 `authMiddleware`（`router.use(authMiddleware)`），所有端點必須帶 JWT。

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

**非標準機制**：沒有任何金流串接。前端按下「模擬付款成功 / 失敗」按鈕直接呼叫此 API。`.env` 的 ECPAY_* 變數**未被使用**。

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
| `/orders/:id` | `order-detail.ejs` | `order-detail.js` | 顯示明細；pending 訂單顯示「模擬付款成功 / 失敗」按鈕；`?payment=success/failed/cancel` 會顯示對應條幅 |

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
- ❌ **真實金流（ECPay）整合**：`.env` 變數保留但程式碼未使用。
- ❌ **商品的 is_active / 上下架**：products 表無此欄位，刪除是唯一隱藏方式。
- ❌ **使用者忘記密碼/重設密碼**。
- ❌ **訂單取消**：使用者無 API 取消；admin 也無更新狀態 API。
- ❌ **後台使用者管理**。
- ❌ **商品分類 / 標籤 / 搜尋 / 排序**：列表只能依 `created_at DESC` 分頁。
- ❌ **Rate limit**：errorHandler 雖有 429 的 SAFE_MESSAGES 但無 middleware 實作。
