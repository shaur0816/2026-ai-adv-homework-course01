# ECPay 金流整合（本地端主動查詢模式）

## 背景

本專案僅運行於本地端（`http://localhost:3001`），綠界 Server Notify
（ReturnURL）為 Server-to-Server，無法直接打到 localhost，且不可使用非
80/443 的 port。傳統的「等綠界 callback 才更新訂單」流程在此環境不適用。

因此付款結果確認改為：**消費者付款後從綠界導回本地端，前端立即呼叫後端
`POST /api/orders/:id/ecpay-query`，由後端主動呼叫綠界 QueryTradeInfo/V5
驗證後同步訂單狀態**。

## 採用方案

| 項目 | 選擇 | 理由 |
|------|------|------|
| 金流服務 | AIO（全方位金流） | 採用率最高、最簡單、SSR 跳轉即可 |
| 協議 | CMV-SHA256 | AIO 預設 |
| 付款方式 | `ChoosePayment=Credit` | 即時可查；ATM/CVS 是離線付款 + 二次 callback，本機環境無法處理 |
| 確認機制 | 本地主動 QueryTradeInfo | 取代 Server Notify，避免依賴外網可達性 |

## 架構流程

```
消費者                Flower Life (localhost)            ECPay Stage
  │                         │                                │
  │  填寫收件資訊 / 送單     │                                │
  │ ───────────────────────→│                                │
  │                         │  建立 order (status=pending)   │
  │                         │                                │
  │  跳轉 /payment/ecpay/:id│                                │
  │ ←───────────────────────│  Server 渲染含 form 的頁面     │
  │                         │  ↳ fetch /api/orders/:id/      │
  │                         │     ecpay-checkout 取得 AIO    │
  │                         │     參數+CheckMacValue          │
  │                         │                                │
  │  auto-submit form       │                                │
  │ ──────────────────────────────────────────────────────→ │  /Cashier/AioCheckOut/V5
  │                         │                                │
  │  在綠界完成測試付款（4311-9522-2222-2222 / 1234）      │
  │ ←──────────────────────────────────────────────────── │  Server Notify (ReturnURL)
  │                         │  ✗ localhost 不可達，忽略      │
  │                         │                                │
  │  導回 OrderResultURL    │                                │
  │  /payment/return/:id    │                                │
  │ ←───────────────────────│  伺服器渲染「處理中」頁面       │
  │  瀏覽器自動 POST /api/orders/:id/ecpay-query             │
  │                         │ ────────→ QueryTradeInfo/V5 ──→│
  │                         │ ←─────── 驗章後判斷 TradeStatus│
  │                         │  更新 order.status, ecpay_*    │
  │                         │                                │
  │  redirect → /orders/:id?payment=success                  │
```

## 重點檔案

| 檔案 | 用途 |
|------|------|
| `src/services/ecpay.js` | ecpayUrlEncode + CheckMacValue + AIO 參數產生 + QueryTradeInfo |
| `src/routes/orderRoutes.js` | `POST /api/orders/:id/ecpay-checkout` 與 `POST /api/orders/:id/ecpay-query` |
| `src/routes/paymentRoutes.js` | 公開路由：`GET /payment/ecpay/:id` 跳轉頁、`/payment/return/:id` 回來頁、`POST /ecpay/notify` 保留入口 |
| `src/database.js` | orders 新增 4 個欄位（idempotent ALTER TABLE） |
| `public/js/pages/checkout.js` | 送單成功後改為導向 `/payment/ecpay/:id` |
| `public/js/pages/order-detail.js` + `views/pages/order-detail.ejs` | 將模擬付款按鈕替換為「前往綠界付款」與「主動向綠界查詢」 |
| `tests/ecpay.test.js` | 服務模組單元測試（含官方 CheckMacValue 測試向量） |

## 訂單資料表新增欄位

| 欄位 | 型別 | 說明 |
|------|------|------|
| `ecpay_trade_no` | TEXT | 送給綠界的 MerchantTradeNo（每次點付款重新產生） |
| `ecpay_tx_no` | TEXT | 綠界回傳的 TradeNo |
| `payment_method` | TEXT | 綠界回傳的 PaymentType，如 `Credit_CreditCard` |
| `paid_at` | TEXT | 綠界回傳的 PaymentDate |

## 重要規則 / 守則

- `MerchantTradeNo` 為「永久唯一」，每次重新發起付款都會 regenerate（覆蓋 `ecpay_trade_no`）
- `CheckMacValue` 使用官方 `ecpayUrlEncode` 演算法（含 .NET 字元還原與 toLowerCase），SHA256
- `verifyCheckMacValue` 使用 `crypto.timingSafeEqual`，避免 timing attack
- `QueryTradeInfo` 的 `TimeStamp` 只有 3 分鐘有效期，每次呼叫前重新產生
- 金額一律以 `INTEGER`（新台幣元）儲存與比對；驗證綠界回傳金額與訂單金額一致，避免被竄改
- 訂單 `status` 機器：`pending → paid`（TradeStatus=1）/ `pending → failed`（TradeStatus=10200095）；其餘狀態不變
- 冪等：相同 TradeStatus 重複查詢不會重設 `paid_at`、不會重扣庫存（庫存在建單即扣）
- 既有 `PATCH /api/orders/:id/pay`（模擬付款）暫時保留，供既有測試與後台手動操作

## 已知限制

- 本機 localhost 無法接收綠界 Server Notify，所以 `ReturnURL` 雖然有實作 `/ecpay/notify`
  並回 `1|OK`，但實務上不會被呼叫到。實際付款確認完全依靠主動查詢。
- ATM / 超商代碼 / 條碼為離線付款，付款後需等綠界 callback，本機環境也只能靠
  排程主動查詢；目前未實作排程，因此預設 `ChoosePayment=Credit`。
- 信用卡退款 (`DoAction`) 與下載對帳檔尚未實作，後續需要時再補。
