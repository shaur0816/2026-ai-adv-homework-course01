const express = require('express');
const db = require('../database');
const ecpay = require('../services/ecpay');

const router = express.Router();

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 綠界 Server Notify 接收端（本機環境通常收不到；保留以便未來透過 tunnel 開放）
// 必須回應 "1|OK" 否則綠界會重試。實際付款結果以主動查詢為準。
router.post('/ecpay/notify', express.urlencoded({ extended: false }), (req, res) => {
  res.type('text').send('1|OK');
});

// 消費者付款完成後，綠界以 Form POST 將結果帶回此頁面（OrderResultURL）。
// 本機環境無法直接信任此頁面參數（CDN/防火牆/外網不可達都會中斷），
// 改為頁面載入後由前端呼叫 /api/orders/:id/ecpay-query 主動向綠界查證。
router.all('/payment/return/:id', express.urlencoded({ extended: false }), (req, res) => {
  const orderId = req.params.id;
  const order = db.prepare('SELECT id, order_no FROM orders WHERE id = ?').get(orderId);
  if (!order) {
    return res.status(404).send('訂單不存在');
  }
  const rtnCode = (req.body && req.body.RtnCode) || (req.query && req.query.RtnCode) || '';
  const html = `<!doctype html>
<html lang="zh-Hant"><head>
<meta charset="utf-8">
<title>付款結果處理中…</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:system-ui,-apple-system,"PingFang TC","Noto Sans TC",sans-serif;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0;
       background:#fdf7f4;color:#3d2f2a}
  .card{background:#fff;border-radius:16px;padding:32px 40px;box-shadow:0 4px 16px rgba(0,0,0,.05);
        max-width:420px;text-align:center}
  .spinner{width:32px;height:32px;border:4px solid #e8b4a8;border-top-color:transparent;
           border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px}
  @keyframes spin{to{transform:rotate(360deg)}}
  .muted{color:#8a7872;font-size:13px;margin-top:8px}
</style>
</head><body>
<div class="card">
  <div class="spinner"></div>
  <div>正在向綠界確認付款結果…</div>
  <div class="muted">訂單 ${escapeHtml(order.order_no)}</div>
  <div class="muted">綠界回傳 RtnCode: ${escapeHtml(rtnCode || '無')}</div>
</div>
<script>
(async function () {
  var orderId = ${JSON.stringify(orderId)};
  var token = localStorage.getItem('flower_token') || '';
  try {
    var res = await fetch('/api/orders/' + orderId + '/ecpay-query', {
      method: 'POST',
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    var json = await res.json();
    var status = json && json.data && json.data.order && json.data.order.status;
    var payment = status === 'paid' ? 'success' : (status === 'failed' ? 'failed' : 'pending');
    window.location.replace('/orders/' + orderId + '?payment=' + payment);
  } catch (e) {
    window.location.replace('/orders/' + orderId + '?payment=failed');
  }
})();
</script>
</body></html>`;
  res.type('html').send(html);
});

// 綠界結帳跳轉頁：取得登入用 token 後呼叫後端 API 取得 AIO 參數，
// 再以 auto-submit form 跳轉到綠界付款頁。
router.get('/payment/ecpay/:id', (req, res) => {
  const orderId = req.params.id;
  const html = `<!doctype html>
<html lang="zh-Hant"><head>
<meta charset="utf-8">
<title>前往綠界付款…</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:system-ui,-apple-system,"PingFang TC","Noto Sans TC",sans-serif;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0;
       background:#fdf7f4;color:#3d2f2a}
  .card{background:#fff;border-radius:16px;padding:32px 40px;box-shadow:0 4px 16px rgba(0,0,0,.05);
        max-width:420px;text-align:center}
  .spinner{width:32px;height:32px;border:4px solid #e8b4a8;border-top-color:transparent;
           border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px}
  @keyframes spin{to{transform:rotate(360deg)}}
  .err{color:#c0392b;margin-top:12px;font-size:14px}
</style>
</head><body>
<div class="card">
  <div class="spinner"></div>
  <div>正在前往綠界付款頁…</div>
  <div id="err" class="err"></div>
</div>
<form id="ecform" style="display:none"></form>
<script>
(async function () {
  var orderId = ${JSON.stringify(orderId)};
  var token = localStorage.getItem('flower_token') || '';
  if (!token) { window.location.href = '/login'; return; }
  try {
    var res = await fetch('/api/orders/' + orderId + '/ecpay-checkout', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token }
    });
    var json = await res.json();
    if (!res.ok || !json.data) {
      document.getElementById('err').textContent = (json && json.message) || '建立付款參數失敗';
      return;
    }
    var form = document.getElementById('ecform');
    form.method = json.data.method;
    form.action = json.data.action;
    Object.entries(json.data.params).forEach(function (entry) {
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = entry[0];
      input.value = entry[1];
      form.appendChild(input);
    });
    form.submit();
  } catch (e) {
    document.getElementById('err').textContent = '建立付款參數失敗';
  }
})();
</script>
</body></html>`;
  res.type('html').send(html);
});

module.exports = router;
