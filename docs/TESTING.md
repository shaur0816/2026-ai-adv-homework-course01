# 測試規範與指南

本專案使用 **Vitest + Supertest** 對 Express app 做整合測試（無單元測試與 mock）。所有測試共用同一個 `database.sqlite`，依固定順序執行以避免互相干擾。

## 執行指令

```bash
npm test            # 等同 vitest run（一次性，不 watch）
npx vitest          # watch 模式（手動執行，未列入 scripts）
npx vitest run tests/auth.test.js  # 跑單一檔案
```

## 設定

檔案：`vitest.config.js`

```js
{
  test: {
    globals: true,           // describe/it/expect 為全域，免 import
    fileParallelism: false,  // 一次只跑一個檔
    sequence: {              // 指定固定順序
      files: [
        'tests/auth.test.js',
        'tests/products.test.js',
        'tests/cart.test.js',
        'tests/orders.test.js',
        'tests/adminProducts.test.js',
        'tests/adminOrders.test.js',
        'tests/ecpay.test.js',
      ],
    },
    hookTimeout: 10000,      // beforeAll/afterAll 上限 10s
  },
}
```

**為什麼 sequential？** 所有測試共用同一個 `database.sqlite`，沒有 transactional 重置；test 之間有資料依賴（譬如 admin 測試會依賴 products seed）。並行會造成資料競爭。

## 測試檔案與依賴

| 檔案 | 受測對象 | 依賴 |
| --- | --- | --- |
| `tests/setup.js` | 共用 import：`app`、`request`、`getAdminToken`、`registerUser` | 啟動 app 並讓 seed 跑 |
| `tests/auth.test.js` | `/api/auth/*` | 無外部依賴；自註冊 user 並保留 token |
| `tests/products.test.js` | `/api/products/*` | 依賴 seed 商品（database.js 自動 seed 8 筆） |
| `tests/cart.test.js` | `/api/cart/*` | 依賴有商品；測 guest 模式 + 註冊 user 後測登入模式 |
| `tests/orders.test.js` | `/api/orders/*` | 依賴有商品；自註冊 user → 加購 → 下單 |
| `tests/adminProducts.test.js` | `/api/admin/products/*` | 依賴 admin seed 帳號 |
| `tests/adminOrders.test.js` | `/api/admin/orders/*` | 依賴 admin seed 帳號；自建一筆訂單 |
| `tests/ecpay.test.js` | `src/services/ecpay.js` 單元測試 | **無外部依賴**——不啟動 app、不碰 DB、不打網路；對外 `fetch` 以 `vi.spyOn` mock |

**為什麼這個順序？**
1. `auth` 最先：確認 register/login 可用，後續測試都依賴它。
2. `products`：純讀，最不破壞性。
3. `cart`：開始寫入 DB 但只影響 cart_items。
4. `orders`：會扣 stock + 清 cart，最具破壞性。
5. `adminProducts`：會新增、改、刪商品，可能影響後續測試。但 admin 測試自己建立的商品自己刪，不影響前面 seed。
6. `adminOrders`：依賴前面有訂單存在（也會自建一筆）。
7. `ecpay`：單元測試，不碰 DB 不打網路，放最後純為一致順序。

## 輔助函式（`tests/setup.js`）

### `getAdminToken()`

以 seed admin 帳號（`admin@hexschool.com` / `12345678`）登入並回傳 token。Admin 測試的 `beforeAll` 都會呼叫。

### `registerUser(overrides?)`

註冊新使用者並回傳 `{ token, user }`。email 預設用 `test-<timestamp>-<random>@example.com` 確保唯一。可傳 `{ email, password, name }` 覆寫。

範例：
```js
const { token, user } = await registerUser();
const { token } = await registerUser({ email: 'x@x.com' });
```

### `app` 與 `request`

分別是 Express app 實例與 `supertest(app)` 對應的 require。慣用法：
```js
const res = await request(app)
  .post('/api/cart')
  .set('Authorization', `Bearer ${token}`)
  .set('X-Session-Id', sessionId)
  .send({ productId, quantity: 1 });

expect(res.status).toBe(200);
expect(res.body).toHaveProperty('error', null);
```

## 撰寫新測試的步驟

1. **新增 test 檔**：`tests/<feature>.test.js`。
2. **引入 setup**：
   ```js
   const { app, request, getAdminToken, registerUser } = require('./setup');
   ```
3. **規劃資料準備**：在 `beforeAll` 完成 register / login / seed 額外資料。
4. **每個 `it`** 應自成一段，但**可以依賴** `beforeAll` 建立的 fixture（本專案不刻意做 per-test isolation）。
5. **斷言三層結構**：所有 API 回應都要驗 `data` / `error` / `message`：
   ```js
   expect(res.body).toHaveProperty('data');
   expect(res.body).toHaveProperty('error', null);   // 成功
   expect(res.body).toHaveProperty('message');
   ```
   失敗則：
   ```js
   expect(res.body).toHaveProperty('data', null);
   expect(res.body.error).not.toBeNull();
   ```
6. **更新 `vitest.config.js` 的 `sequence.files`**：將新檔案插入適當位置（破壞性高的放後面）。
7. **執行** `npm test` 驗證所有檔案仍通過。

### 範例骨架

```js
const { app, request, registerUser } = require('./setup');

describe('Coupon API', () => {
  let userToken;

  beforeAll(async () => {
    const { token } = await registerUser();
    userToken = token;
  });

  it('should list coupons', async () => {
    const res = await request(app)
      .get('/api/coupons')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('error', null);
  });
});
```

## 常見陷阱

### 1. 資料庫沒重置

每次 `npm test` 跑完 `database.sqlite` 會留下新註冊的 user、新建的 cart、新建的 order 等。**多跑幾次後 DB 會膨脹**但測試仍會通過，因為：
- email 帶 timestamp 確保唯一。
- 訂單 / cart 都是「自建自用」。
- admin 測試「新增→刪除」自我清理商品。

若懷疑測試環境受污染，可刪除 `database.sqlite*` 三個檔案，下次啟動會 reseed。**注意：這會清掉所有資料**。

### 2. bcrypt 在測試慢

正式環境 `saltRounds=10`，每次 hash 約 100ms。`src/database.js` 的 `seedAdminUser()` 與 `tests` 流程都會碰到。
**已優化**：seed 時若 `NODE_ENV === 'test'` 會降為 `saltRounds=1`。但 `authRoutes.js` 的註冊仍用 10——如果之後加入大量 register 的測試需注意。

### 3. fileParallelism 必須關閉

若把 `fileParallelism` 改 true，cart/orders 與 admin tests 會互相寫入同一張 `products` 表的 stock 欄位，造成隨機失敗。**不要動這個設定**。

### 4. CORS 不影響測試

Supertest 直接呼叫 app（非真實 HTTP），不會經過 CORS 驗證；測試裡無需擔心 `FRONTEND_URL`。

### 5. JWT_SECRET 必須在環境

測試要能成功 verify token。`tests/setup.js` 載入 `app` 時 `require('dotenv').config()` 已先跑（在 `app.js` 第 1 行），所以本地需要 `.env` 存在且 `JWT_SECRET` 有值。若 CI 環境請於 workflow 中設定 `JWT_SECRET` env var。

### 6. 訂單測試會扣庫存

`orders.test.js` 會建立訂單並扣 stock。若反覆執行很多次直到某商品 stock 歸 0，後續測試可能失敗。當前 seed 數量充裕（最少 15、最多 100），實務上不會碰到，但**新增「會大量建單」的測試**時請小心。

### 7. Test 之間共用 admin 帳號

多個 admin tests 都用 `getAdminToken()`。token 7 天有效，重跑 OK，但**不要在某個測試裡修改 admin 自己的角色或刪除 admin user**——會破壞後續測試。

### 8. 環境變數隔離

整個 vitest run 共用 process env。若某測試 mutate `process.env`，會影響後續測試。**不要動 `process.env`**；若必要請在 `afterEach` 還原。

例外：`tests/ecpay.test.js` 在檔案頂部設定 `ECPAY_*` 為綠界官方公開測試帳號，並**在 require service 之前**完成；這些值與 `.env.example` 預設相同，不會干擾其他測試。

### 9. Mock 對外 fetch（給 service 單元測試）

`tests/ecpay.test.js` 示範了如何在不打網路的情況下測試對外 API：

```js
const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
  // ...組出符合官方協議的回應字串...
  return { ok: true, status: 200, text: async () => body };
});

await ecpay.queryTradeInfo('EC123');
fetchSpy.mockRestore();   // 一定要 restore，避免污染後續測試
```

要點：
- Vitest 已啟用 `globals: true`，可直接用 `vi`、`describe`、`it`、`expect`，**不需要** `require('vitest')`（CJS 不支援，會報錯）。
- mock 結束務必 `mockRestore()`，否則後面的測試也會被攔截。
- 若服務內含加密 / 簽章，回應要重新簽（使用同一份 service function 計算），這樣才能完整測到驗章邏輯。
