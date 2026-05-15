# Changelog

本檔記錄專案的重大變更。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)；版本依 [Semantic Versioning](https://semver.org/lang/zh-TW/) 管理。

新增條目時請放在最上方，使用 `### 新增 / 變更 / 修正 / 移除` 分類，並標註日期（YYYY-MM-DD）。

---

## [Unreleased]

### 新增
- 建立 `docs/` 結構與 `CLAUDE.md`：包含 README、ARCHITECTURE、DEVELOPMENT、FEATURES、TESTING 等文件 — 2026-05-14

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
