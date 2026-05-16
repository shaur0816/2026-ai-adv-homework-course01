const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const authMiddleware = require('../middleware/authMiddleware');
const ecpay = require('../services/ecpay');

const router = express.Router();

router.use(authMiddleware);

function getBaseUrl(req) {
  return (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function generateOrderNo() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const random = uuidv4().slice(0, 5).toUpperCase();
  return `ORD-${dateStr}-${random}`;
}

/**
 * @openapi
 * /api/orders:
 *   post:
 *     summary: 從購物車建立訂單
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipientName, recipientEmail, recipientAddress]
 *             properties:
 *               recipientName:
 *                 type: string
 *               recipientEmail:
 *                 type: string
 *                 format: email
 *               recipientAddress:
 *                 type: string
 *     responses:
 *       201:
 *         description: 訂單建立成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     order_no:
 *                       type: string
 *                     total_amount:
 *                       type: integer
 *                     status:
 *                       type: string
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           product_name:
 *                             type: string
 *                           product_price:
 *                             type: integer
 *                           quantity:
 *                             type: integer
 *                     created_at:
 *                       type: string
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       400:
 *         description: 購物車為空或庫存不足或收件資訊缺失
 */
router.post('/', (req, res) => {
  const { recipientName, recipientEmail, recipientAddress } = req.body;
  const userId = req.user.userId;

  if (!recipientName || !recipientEmail || !recipientAddress) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: '收件人姓名、Email 和地址為必填欄位'
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(recipientEmail)) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: 'Email 格式不正確'
    });
  }

  // Get cart items with product info
  const cartItems = db.prepare(
    `SELECT ci.id, ci.product_id, ci.quantity,
            p.name as product_name, p.price as product_price, p.stock as product_stock
     FROM cart_items ci
     JOIN products p ON ci.product_id = p.id
     WHERE ci.user_id = ?`
  ).all(userId);

  if (cartItems.length === 0) {
    return res.status(400).json({
      data: null,
      error: 'CART_EMPTY',
      message: '購物車為空'
    });
  }

  // Check stock
  const insufficientItems = cartItems.filter(item => item.quantity > item.product_stock);
  if (insufficientItems.length > 0) {
    const names = insufficientItems.map(i => i.product_name).join(', ');
    return res.status(400).json({
      data: null,
      error: 'STOCK_INSUFFICIENT',
      message: `以下商品庫存不足：${names}`
    });
  }

  // Calculate total
  const totalAmount = cartItems.reduce(
    (sum, item) => sum + item.product_price * item.quantity, 0
  );

  const orderId = uuidv4();
  const orderNo = generateOrderNo();

  // Transaction: create order, order items, deduct stock, clear cart
  const createOrder = db.transaction(() => {
    db.prepare(
      `INSERT INTO orders (id, order_no, user_id, recipient_name, recipient_email, recipient_address, total_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(orderId, orderNo, userId, recipientName, recipientEmail, recipientAddress, totalAmount);

    const insertItem = db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, product_name, product_price, quantity)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const updateStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');

    for (const item of cartItems) {
      insertItem.run(uuidv4(), orderId, item.product_id, item.product_name, item.product_price, item.quantity);
      updateStock.run(item.quantity, item.product_id);
    }

    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);
  });

  createOrder();

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const orderItems = db.prepare(
    'SELECT product_name, product_price, quantity FROM order_items WHERE order_id = ?'
  ).all(orderId);

  res.status(201).json({
    data: {
      id: order.id,
      order_no: order.order_no,
      total_amount: order.total_amount,
      status: order.status,
      items: orderItems,
      created_at: order.created_at
    },
    error: null,
    message: '訂單建立成功'
  });
});

/**
 * @openapi
 * /api/orders:
 *   get:
 *     summary: 自己的訂單列表
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
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
 *                   properties:
 *                     orders:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           order_no:
 *                             type: string
 *                           total_amount:
 *                             type: integer
 *                           status:
 *                             type: string
 *                           created_at:
 *                             type: string
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 */
router.get('/', (req, res) => {
  const orders = db.prepare(
    'SELECT id, order_no, total_amount, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user.userId);

  res.json({
    data: { orders },
    error: null,
    message: '成功'
  });
});

/**
 * @openapi
 * /api/orders/{id}:
 *   get:
 *     summary: 訂單詳情
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *                   properties:
 *                     id:
 *                       type: string
 *                     order_no:
 *                       type: string
 *                     recipient_name:
 *                       type: string
 *                     recipient_email:
 *                       type: string
 *                     recipient_address:
 *                       type: string
 *                     total_amount:
 *                       type: integer
 *                     status:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           product_id:
 *                             type: string
 *                           product_name:
 *                             type: string
 *                           product_price:
 *                             type: integer
 *                           quantity:
 *                             type: integer
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       404:
 *         description: 訂單不存在
 */
router.get('/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);

  if (!order) {
    return res.status(404).json({ data: null, error: 'NOT_FOUND', message: '訂單不存在' });
  }

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);

  res.json({
    data: { ...order, items },
    error: null,
    message: '成功'
  });
});

/**
 * @openapi
 * /api/orders/{id}/pay:
 *   patch:
 *     summary: 模擬付款（更新訂單付款狀態）
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [success, fail]
 *     responses:
 *       200:
 *         description: 付款狀態更新成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     order_no:
 *                       type: string
 *                     total_amount:
 *                       type: integer
 *                     status:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           product_name:
 *                             type: string
 *                           product_price:
 *                             type: integer
 *                           quantity:
 *                             type: integer
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       400:
 *         description: action 無效或訂單狀態不是 pending
 *       404:
 *         description: 訂單不存在
 */
router.patch('/:id/pay', (req, res) => {
  const { action } = req.body;
  const userId = req.user.userId;

  const actionMap = { success: 'paid', fail: 'failed' };
  if (!action || !actionMap[action]) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: 'action 必須為 success 或 fail'
    });
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!order) {
    return res.status(404).json({ data: null, error: 'NOT_FOUND', message: '訂單不存在' });
  }

  if (order.status !== 'pending') {
    return res.status(400).json({
      data: null,
      error: 'INVALID_STATUS',
      message: '訂單狀態不是 pending，無法付款'
    });
  }

  const newStatus = actionMap[action];
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(newStatus, order.id);

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);

  res.json({
    data: { ...updated, items },
    error: null,
    message: action === 'success' ? '付款成功' : '付款失敗'
  });
});

/**
 * @openapi
 * /api/orders/{id}/ecpay-checkout:
 *   post:
 *     summary: 產生綠界 ECPay AIO 付款參數
 *     description: |
 *       回傳跳轉至綠界付款頁所需的 form 參數（含 CheckMacValue）與目標 URL。
 *       前端需以該 URL 為 action、所有欄位為 hidden input 送出 form。
 *       每次呼叫會重新產生一組 MerchantTradeNo（永久唯一），覆蓋訂單上的舊值。
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 成功
 *       400:
 *         description: 訂單狀態不是 pending
 *       404:
 *         description: 訂單不存在
 */
router.post('/:id/ecpay-checkout', (req, res, next) => {
  try {
    const userId = req.user.userId;
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!order) {
      return res.status(404).json({ data: null, error: 'NOT_FOUND', message: '訂單不存在' });
    }
    if (order.status !== 'pending') {
      return res.status(400).json({
        data: null,
        error: 'INVALID_STATUS',
        message: '訂單狀態不是 pending，無法重新付款'
      });
    }

    const items = db.prepare('SELECT product_name, quantity FROM order_items WHERE order_id = ?').all(order.id);
    const merchantTradeNo = ecpay.generateMerchantTradeNo('EC');
    db.prepare('UPDATE orders SET ecpay_trade_no = ? WHERE id = ?').run(merchantTradeNo, order.id);

    const baseUrl = getBaseUrl(req);
    // 本機開發無法接收綠界 Server Notify，ReturnURL 仍依官方要求帶上（會記錄但不依賴），
    // 真正的付款確認改由 OrderResultURL 回到本地後主動呼叫 QueryTradeInfo 完成。
    const params = ecpay.buildAioCheckoutParams({
      merchantTradeNo,
      totalAmount: order.total_amount,
      items,
      returnUrl: `${baseUrl}/api/orders/ecpay/notify`,
      orderResultUrl: `${baseUrl}/payment/return/${order.id}`,
      clientBackUrl: `${baseUrl}/orders/${order.id}?payment=cancel`
    });

    res.json({
      data: {
        action: ecpay.getEndpoints().aio,
        method: 'POST',
        params
      },
      error: null,
      message: '成功'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/orders/{id}/ecpay-query:
 *   post:
 *     summary: 主動向綠界查詢付款結果並同步訂單狀態
 *     description: |
 *       本機環境無法接收綠界 Server Notify，付款後改由本地端呼叫此 API 主動查詢
 *       /Cashier/QueryTradeInfo/V5 驗證付款。已驗證 CheckMacValue 並具冪等性
 *       （相同 TradeStatus 重複呼叫不會重覆扣庫存或重設付款時間）。
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 成功（含最新 status / TradeStatus / PaymentType）
 *       400:
 *         description: 訂單尚未發起綠界付款
 *       404:
 *         description: 訂單不存在
 *       502:
 *         description: 綠界查詢失敗或驗章失敗
 */
router.post('/:id/ecpay-query', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!order) {
      return res.status(404).json({ data: null, error: 'NOT_FOUND', message: '訂單不存在' });
    }
    if (!order.ecpay_trade_no) {
      return res.status(400).json({
        data: null,
        error: 'NO_ECPAY_TRADE',
        message: '此訂單尚未發起綠界付款，請先前往綠界結帳'
      });
    }

    const queryResult = await ecpay.queryTradeInfo(order.ecpay_trade_no);

    // TradeStatus: 0=未付款, 1=已付款, 10200095=交易未成立
    const tradeStatus = String(queryResult.TradeStatus || '');
    const paymentType = queryResult.PaymentType || null;
    const ecpayTxNo = queryResult.TradeNo || null;
    const paymentDate = queryResult.PaymentDate || null;
    const tradeAmt = parseInt(queryResult.TradeAmt || '0', 10);

    let newStatus = order.status;
    if (order.status === 'pending') {
      if (tradeStatus === '1') {
        // 額外金額驗證：避免被竄改的回應通過驗章但金額對不上
        if (tradeAmt !== order.total_amount) {
          return res.status(502).json({
            data: null,
            error: 'AMOUNT_MISMATCH',
            message: '綠界回傳金額與訂單金額不符'
          });
        }
        newStatus = 'paid';
      } else if (tradeStatus === '10200095') {
        newStatus = 'failed';
      }
    }

    if (newStatus !== order.status || ecpayTxNo !== order.ecpay_tx_no) {
      const paidAt = newStatus === 'paid' ? (paymentDate || new Date().toISOString()) : order.paid_at;
      db.prepare(
        'UPDATE orders SET status = ?, ecpay_tx_no = ?, payment_method = ?, paid_at = ? WHERE id = ?'
      ).run(newStatus, ecpayTxNo, paymentType, paidAt, order.id);
    }

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    res.json({
      data: {
        order: updated,
        ecpay: {
          MerchantTradeNo: queryResult.MerchantTradeNo,
          TradeNo: ecpayTxNo,
          TradeStatus: tradeStatus,
          PaymentType: paymentType,
          PaymentDate: paymentDate,
          TradeAmt: tradeAmt
        }
      },
      error: null,
      message: '查詢成功'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
