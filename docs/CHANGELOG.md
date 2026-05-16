# Changelog

本檔記錄專案的重大變更。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)；版本依 [Semantic Versioning](https://semver.org/lang/zh-TW/) 管理。

新增條目時請放在最上方，使用 `### 新增 / 變更 / 修正 / 移除` 分類，並標註日期（YYYY-MM-DD）。

---

## [Unreleased]

### 新增
- 串接綠界 ECPay AIO 金流（信用卡），採「本地主動查詢」模式取代 Server Notify — 2026-05-15
  - 新增 `src/services/ecpay.js`：`ecpayUrlEncode`、`CheckMacValue` 產生與 timing-safe 驗章、`buildAioCheckoutParams`、`queryTradeInfo`（POST `/Cashier/QueryTradeInfo/V5` + 驗章 + 解析 URL-encoded 回應）。CheckMacValue 對得上官方 3 組測試向量。
  - 新增 `POST /api/orders/:id/ecpay-checkout`：產生跳轉綠界所需的 AIO 參數（含 CheckMacValue），每次呼叫重新產生一組 `MerchantTradeNo`（永久唯一，覆蓋訂單上的舊值）。
  - 新增 `POST /api/orders/:id/ecpay-query`：本地主動呼叫綠界 QueryTradeInfo/V5 並驗章，依 `TradeStatus`（`1` → paid、`10200095` → failed、其餘不動）冪等更新訂單。金額不符會拒絕入帳。
  - 新增 `src/routes/paymentRoutes.js`（公開路由）：`GET /payment/ecpay/:id` 自動 submit form 跳轉到綠界；`/payment/return/:id` 接綠界 OrderResultURL 並在頁面載入時觸發主動查詢；`POST /ecpay/notify` 保留 `1|OK` 入口供未來透過 tunnel 工具開放。
  - `orders` 表新增 4 個欄位（idempotent ALTER）：`ecpay_trade_no`、`ecpay_tx_no`、`payment_method`、`paid_at`。
  - 前端：結帳成功後改導 `/payment/ecpay/:id`；訂單詳情頁將「模擬付款成功/失敗」按鈕替換為「前往綠界付款」與「主動向綠界查詢付款結果」，並顯示綠界交易編號與付款時間。
  - 測試：新增 `tests/ecpay.test.js`（9 個單元測試，含官方 CheckMacValue 測試向量與 fetch mock 驗證；無外部網路依賴）。
- 建立 `docs/` 結構與 `CLAUDE.md`：包含 README、ARCHITECTURE、DEVELOPMENT、FEATURES、TESTING 等文件 — 2026-05-14

### 變更
- `POST /api/orders` 建單成功後，前端 checkout 流程改為直接導向 `/payment/ecpay/:id`（不再停在訂單頁等模擬付款）— 2026-05-15
- `PATCH /api/orders/:id/pay`（模擬付款）暫時保留以維持向下相容（既有測試與後台手動操作），但前台已不再使用 — 2026-05-15

---

## [1.0.0] — 2026-05-14（初始版本）

### 新增
- Express + EJS + SQLite (better-sqlite3) 單體應用基礎結構
- JWT 認證機制（HS256, 7d 有效期）+ Admin 角色檢查
- X-Session-Id 訪客購物車支援（與 JWT 雙模式並存於 `/api/cart`）
- 商品 CRUD（前台公開讀取、後台 admin 管理）
- 購物車 CRUD（dualAuth）
- 訂單建立（含 transaction：寫單 → 寫品項 → 扣庫存 → 清車）、列表、詳情、模擬付款
- 後台訂單列表（含 status 篩選）與詳情（含買家資訊）
- SSR 頁面：首頁、商品詳情、購物車、結帳、登入/註冊、訂單列表、訂單詳情、後台商品/訂單
- Vue 3（CDN）+ Tailwind CSS v4 前端
- swagger-jsdoc 整合，可由 `npm run openapi` 產生 OpenAPI 3.0.3 規格
- Vitest + Supertest 測試：auth / products / cart / orders / adminProducts / adminOrders 共 6 檔
- 統一 API 回應格式 `{ data, error, message }` 與全域 errorHandler（500 隱藏細節）
- 自動 seed：admin 帳號（`admin@hexschool.com` / `12345678`）與 8 筆 demo 商品
