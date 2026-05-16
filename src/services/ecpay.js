const crypto = require('crypto');
const querystring = require('querystring');

const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID;
const HASH_KEY = process.env.ECPAY_HASH_KEY;
const HASH_IV = process.env.ECPAY_HASH_IV;
const ENV = (process.env.ECPAY_ENV || 'staging').toLowerCase();

const ENDPOINTS = {
  staging: {
    aio: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5',
    query: 'https://payment-stage.ecpay.com.tw/Cashier/QueryTradeInfo/V5'
  },
  production: {
    aio: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5',
    query: 'https://payment.ecpay.com.tw/Cashier/QueryTradeInfo/V5'
  }
};

function getEndpoints() {
  return ENV === 'production' ? ENDPOINTS.production : ENDPOINTS.staging;
}

function assertConfigured() {
  if (!MERCHANT_ID || !HASH_KEY || !HASH_IV) {
    const err = new Error('ECPay 環境變數未設定 (ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV)');
    err.status = 500;
    throw err;
  }
}

// ecpayUrlEncode: encodeURIComponent → %20→+ → ~→%7e → '→%27 → toLowerCase → .NET 字元還原
function ecpayUrlEncode(raw) {
  return encodeURIComponent(raw)
    .replace(/%20/g, '+')
    .replace(/~/g, '%7e')
    .replace(/'/g, '%27')
    .toLowerCase()
    .replace(/%2d/g, '-')
    .replace(/%5f/g, '_')
    .replace(/%2e/g, '.')
    .replace(/%21/g, '!')
    .replace(/%2a/g, '*')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')');
}

function generateCheckMacValue(params) {
  const sorted = Object.entries(params)
    .filter(([k]) => k !== 'CheckMacValue')
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const raw = `HashKey=${HASH_KEY}&` +
    sorted.map(([k, v]) => `${k}=${v}`).join('&') +
    `&HashIV=${HASH_IV}`;
  const encoded = ecpayUrlEncode(raw);
  return crypto.createHash('sha256').update(encoded).digest('hex').toUpperCase();
}

function verifyCheckMacValue(params) {
  const received = params.CheckMacValue;
  if (!received) return false;
  const computed = generateCheckMacValue(params);
  const a = Buffer.from(computed);
  const b = Buffer.from(String(received).toUpperCase());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// yyyy/MM/dd HH:mm:ss in UTC+8（Asia/Taipei）
function formatTradeDate(date = new Date()) {
  const tw = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${tw.getUTCFullYear()}/${pad(tw.getUTCMonth() + 1)}/${pad(tw.getUTCDate())} ` +
    `${pad(tw.getUTCHours())}:${pad(tw.getUTCMinutes())}:${pad(tw.getUTCSeconds())}`;
}

// MerchantTradeNo：英數字 ≤ 20 字元，永久唯一
function generateMerchantTradeNo(prefix = 'EC') {
  const ts = Date.now().toString();
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return (prefix + ts + rand).slice(0, 20);
}

// 過濾 ItemName/TradeDesc：移除可能觸發 WAF 的字元
function sanitizeText(text, maxLen) {
  if (!text) return '';
  const cleaned = String(text)
    .replace(/[\x00-\x1F]/g, '')
    .replace(/[<>]/g, '')
    .trim();
  return cleaned.slice(0, maxLen);
}

function buildItemName(items) {
  // 多項商品用 # 分隔，含數量
  const segments = items.map(it => `${sanitizeText(it.product_name, 50)} x${it.quantity}`);
  return sanitizeText(segments.join('#'), 200);
}

function buildAioCheckoutParams({ merchantTradeNo, totalAmount, items, returnUrl, orderResultUrl, clientBackUrl }) {
  assertConfigured();
  const params = {
    MerchantID: MERCHANT_ID,
    MerchantTradeNo: merchantTradeNo,
    MerchantTradeDate: formatTradeDate(),
    PaymentType: 'aio',
    TotalAmount: Math.round(totalAmount),
    TradeDesc: sanitizeText('Flower Life 訂單付款', 200),
    ItemName: buildItemName(items),
    ReturnURL: returnUrl,
    ChoosePayment: 'Credit',
    EncryptType: 1
  };
  if (orderResultUrl) params.OrderResultURL = orderResultUrl;
  if (clientBackUrl) params.ClientBackURL = clientBackUrl;
  params.CheckMacValue = generateCheckMacValue(params);
  return params;
}

async function queryTradeInfo(merchantTradeNo) {
  assertConfigured();
  const params = {
    MerchantID: MERCHANT_ID,
    MerchantTradeNo: merchantTradeNo,
    TimeStamp: Math.floor(Date.now() / 1000) // 注意：3 分鐘有效期，每次呼叫前重新產生
  };
  params.CheckMacValue = generateCheckMacValue(params);

  const body = querystring.stringify(params);
  let res;
  try {
    res = await fetch(getEndpoints().query, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
  } catch (e) {
    const err = new Error('無法連線到綠界查詢服務');
    err.status = 502;
    err.isOperational = true;
    throw err;
  }

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`綠界查詢服務回應 HTTP ${res.status}`);
    err.status = 502;
    err.isOperational = true;
    throw err;
  }

  const parsed = querystring.parse(text);
  if (!verifyCheckMacValue(parsed)) {
    const err = new Error('綠界查詢回應驗章失敗');
    err.status = 502;
    err.isOperational = true;
    throw err;
  }
  return parsed;
}

module.exports = {
  ENV,
  getEndpoints,
  ecpayUrlEncode,
  generateCheckMacValue,
  verifyCheckMacValue,
  formatTradeDate,
  generateMerchantTradeNo,
  buildAioCheckoutParams,
  queryTradeInfo
};
