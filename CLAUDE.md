# CLAUDE.md

## 專案概述

**花漾生活 Flower Life** — 花卉電商網站，前後端整合於同一 Express 應用，採 SSR (EJS Layout + Partial) + 客戶端 Vue 3 (CDN) 混合渲染。

技術棧：
- **後端**：Node.js + Express 4.16，CommonJS 模組
- **資料庫**：SQLite (better-sqlite3，同步 API)，啟用 WAL 模式、外鍵約束
- **認證**：JWT（HS256，7d 有效期）+ X-Session-Id（訪客購物車）雙模式
- **前端**：EJS 模板 + Vue 3 Global Build (CDN) + Tailwind CSS v4
- **測試**：Vitest + Supertest，sequential 執行
- **API 文件**：swagger-jsdoc 從路由註解生成 OpenAPI 3.0.3

## 常用指令

| 指令 | 用途 |
| --- | --- |
| `npm start` | 編譯 Tailwind（minify）+ 啟動伺服器，預設 port 3001 |
| `npm run dev:server` | 僅啟動 Express 伺服器（不重建 CSS） |
| `npm run dev:css` | 以 watch 模式編譯 Tailwind 至 `public/css/output.css` |
| `npm run css:build` | 一次性最小化編譯 Tailwind |
| `npm run openapi` | 由路由 JSDoc 註解生成 `openapi.json` |
| `npm test` | 執行 Vitest（vitest run，sequential，不並行） |

## 關鍵規則

- **統一 API 回應格式**：所有 `/api/*` 端點皆回傳 `{ data, error, message }`；成功時 `error: null`，失敗時 `data: null` 並帶上錯誤碼字串（如 `VALIDATION_ERROR`、`UNAUTHORIZED`、`NOT_FOUND`、`CONFLICT`、`STOCK_INSUFFICIENT`、`CART_EMPTY`、`INVALID_STATUS`、`INTERNAL_ERROR`）。新增端點請延續此格式。
- **購物車雙模式認證**：`/api/cart` 路由透過內嵌的 `dualAuth` 函式判斷 — 有 `Authorization: Bearer <token>` 走 JWT，否則 fallback 至 `X-Session-Id` header；兩者皆無則 401。其他路由不要照抄這個邏輯。
- **訂單建立必須使用 transaction**：`createOrder` 內含「寫 orders → 寫 order_items → 扣 products.stock → 清 cart_items」四步，必須包在 `db.transaction(...)` 內，避免半完成狀態。
- **金額一律整數**：`price`、`total_amount` 在 SQLite 內皆為 `INTEGER`（單位：新台幣元），不可改為浮點數。
- **錯誤訊息保護**：500 錯誤一律回傳「伺服器內部錯誤」，不洩漏內部細節（見 `src/middleware/errorHandler.js`）。僅 `err.isOperational === true` 才能回傳自訂訊息。
- **JWT_SECRET 缺失即拒啟動**：`server.js` 啟動前會檢查 `process.env.JWT_SECRET`，未設定直接 `process.exit(1)`。
- 功能開發使用 `docs/plans/` 記錄計畫；完成後移至 `docs/plans/archive/`。

## 詳細文件

- [./docs/README.md](./docs/README.md) — 項目介紹、快速開始、技術棧
- [./docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — 架構、目錄結構、資料流、API 路由表、DB schema
- [./docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) — 開發規範、命名規則、計畫歸檔流程
- [./docs/FEATURES.md](./docs/FEATURES.md) — 功能清單與行為描述（含查詢參數、業務邏輯、錯誤碼）
- [./docs/TESTING.md](./docs/TESTING.md) — 測試規範與指南、執行順序、共用輔助函式
- [./docs/CHANGELOG.md](./docs/CHANGELOG.md) — 更新日誌
