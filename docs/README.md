# 花漾生活 Flower Life

花卉電商網站 Demo。包含商品瀏覽、購物車、結帳下單、訂單付款模擬、後台商品/訂單管理。前後端一體：Express 同時提供 REST API（`/api/*`）與 SSR 頁面（EJS Layout + Vue 3 CDN）。

## 技術棧

| 類別 | 技術 | 版本 | 備註 |
| --- | --- | --- | --- |
| Runtime | Node.js | — | CommonJS (`require`) |
| Web 框架 | Express | ~4.16.1 | router 拆分於 `src/routes/*` |
| 資料庫 | SQLite | better-sqlite3 ^12 | 同步 API；WAL 模式；外鍵 ON |
| 認證 | JSON Web Token | jsonwebtoken ^9 | HS256；`expiresIn: '7d'` |
| 雜湊 | bcrypt | ^6 | `saltRounds = 10`（測試環境降為 1） |
| 模板引擎 | EJS | ^5 | `views/` 目錄；含 layout 與 partial |
| 前端框架 | Vue 3 | global build (CDN) | 由 `unpkg.com` 載入，無 build step |
| CSS | Tailwind CSS | v4 | `@tailwindcss/cli` 編譯 |
| 唯一識別 | uuid | ^11 | 主鍵與訂單編號 |
| CORS | cors | ^2.8 | origin 由 `FRONTEND_URL` 控制 |
| 環境變數 | dotenv | ^16 | 啟動時自動載入 `.env` |
| 測試 | Vitest + Supertest | ^2.1 / ^7.2 | sequential 模式 |
| API 文件 | swagger-jsdoc | ^6.2 | 由路由 JSDoc 註解產生 |

## 快速開始

```bash
# 1. 安裝依賴
npm install

# 2. 設定環境變數（必須）
cp .env.example .env
# 編輯 .env，將 JWT_SECRET 改為任意長字串
# 若不改，伺服器仍可啟動但安全性極差；測試時直接使用範例值即可

# 3. 啟動（會同時編譯 Tailwind 並啟動伺服器）
npm start

# 4. 瀏覽
# 前台：http://localhost:3001/
# 後台：http://localhost:3001/admin/products
# 預設管理員帳號：admin@hexschool.com / 12345678
```

開發模式建議開兩個 terminal：
```bash
# Terminal A：監看 Tailwind
npm run dev:css

# Terminal B：啟動伺服器（不重新編譯 CSS）
npm run dev:server
```

## 常用指令

| 指令 | 用途 |
| --- | --- |
| `npm start` | 編譯 Tailwind（minify）+ 啟動 `server.js` |
| `npm run dev:server` | 僅啟動伺服器（依賴已編譯好的 `public/css/output.css`） |
| `npm run dev:css` | Tailwind watch 模式 |
| `npm run css:build` | 一次性最小化編譯 Tailwind |
| `npm run openapi` | 由路由 JSDoc 產生 `openapi.json` 至專案根目錄 |
| `npm test` | 執行 Vitest（`vitest run`） |

## 預設帳號

| 角色 | Email | 密碼 | 備註 |
| --- | --- | --- | --- |
| Admin | `admin@hexschool.com` | `12345678` | 由 `seedAdminUser()` 於首次啟動時建立；可由 `.env` 的 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 覆寫 |
| 一般使用者 | — | — | 透過 `/api/auth/register` 註冊 |

## 文件索引

| 文件 | 內容 |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 目錄結構、啟動流程、API 路由總覽、回應格式、認證機制、DB schema |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 命名規則、模組系統、新增 API/middleware/DB 的步驟、環境變數表、JSDoc 範例、計畫歸檔流程 |
| [FEATURES.md](./FEATURES.md) | 各功能區塊行為描述（查詢參數、Body 欄位、業務邏輯、錯誤情境） |
| [TESTING.md](./TESTING.md) | 測試檔案表、執行順序、輔助函式、撰寫新測試的步驟與陷阱 |
| [CHANGELOG.md](./CHANGELOG.md) | 變更紀錄 |

## 專案目錄速覽

```
.
├── app.js                  # Express app 組裝（中介、路由、404、錯誤處理）
├── server.js               # 啟動入口；檢查 JWT_SECRET 後 listen
├── generate-openapi.js     # 由 JSDoc 產出 openapi.json
├── swagger-config.js       # swagger-jsdoc 設定
├── vitest.config.js        # 測試設定（sequential、固定順序）
├── database.sqlite         # SQLite 主資料庫檔（gitignored）
├── public/                 # 靜態檔（CSS、前端 JS）
├── views/                  # EJS 模板（layouts / pages / partials）
├── src/
│   ├── database.js         # DB 初始化、建表、seed
│   ├── middleware/         # auth / admin / session / errorHandler
│   └── routes/             # auth / products / cart / orders / adminProducts / adminOrders / pageRoutes
├── tests/                  # Vitest 測試
└── docs/                   # 你正在看的這個目錄
```
