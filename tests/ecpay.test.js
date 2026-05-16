// Use official ECPay public test merchant credentials so vectors stay valid
process.env.ECPAY_MERCHANT_ID = '3002607';
process.env.ECPAY_HASH_KEY = 'pwFHCqoQZGmho4w6';
process.env.ECPAY_HASH_IV = 'EkRm7iFT261dpevs';
process.env.ECPAY_ENV = 'staging';

const ecpay = require('../src/services/ecpay');

describe('ecpay service', () => {
  it('generates expected CheckMacValue for official baseline vector', () => {
    const params = {
      MerchantID: '3002607',
      MerchantTradeNo: 'Test1234567890',
      MerchantTradeDate: '2025/01/01 12:00:00',
      PaymentType: 'aio',
      TotalAmount: '100',
      TradeDesc: '測試',
      ItemName: '測試商品',
      ReturnURL: 'https://example.com/notify',
      ChoosePayment: 'ALL',
      EncryptType: '1'
    };
    expect(ecpay.generateCheckMacValue(params)).toBe(
      '291CBA324D31FB5A4BBBFDF2CFE5D32598524753AFD4959C3BF590C5B2F57FB2'
    );
  });

  it('handles apostrophe in ItemName', () => {
    expect(ecpay.generateCheckMacValue({
      MerchantID: '3002607',
      ItemName: "Tom's Shop",
      TotalAmount: '100'
    })).toBe('CF0A3D4901D99459D8641516EC57210700E8A5C9AB26B1D021301E9CB93EF78D');
  });

  it('handles tilde in ItemName', () => {
    expect(ecpay.generateCheckMacValue({
      MerchantID: '3002607',
      ItemName: 'Test~Product',
      TotalAmount: '200'
    })).toBe('CEEAE01D2F9A8E74D4AC0DCE7735B046D73F35A5EC99558A31A2EE03159DA1C9');
  });

  it('verifyCheckMacValue returns true for valid pair', () => {
    const params = { MerchantID: '3002607', TotalAmount: '100', ItemName: 'A' };
    params.CheckMacValue = ecpay.generateCheckMacValue(params);
    expect(ecpay.verifyCheckMacValue(params)).toBe(true);
  });

  it('verifyCheckMacValue rejects tampered payload', () => {
    const params = { MerchantID: '3002607', TotalAmount: '100', ItemName: 'A' };
    params.CheckMacValue = ecpay.generateCheckMacValue(params);
    params.TotalAmount = '99999';
    expect(ecpay.verifyCheckMacValue(params)).toBe(false);
  });

  it('generateMerchantTradeNo produces 20-char alphanumeric', () => {
    const no = ecpay.generateMerchantTradeNo('EC');
    expect(no).toMatch(/^[A-Za-z0-9]+$/);
    expect(no.length).toBeLessThanOrEqual(20);
    expect(no.startsWith('EC')).toBe(true);
  });

  it('buildAioCheckoutParams includes valid CheckMacValue', () => {
    const params = ecpay.buildAioCheckoutParams({
      merchantTradeNo: 'EC20260515ABCDE',
      totalAmount: 1680,
      items: [{ product_name: '粉色玫瑰花束', quantity: 1 }],
      returnUrl: 'https://example.com/notify',
      orderResultUrl: 'https://example.com/return',
      clientBackUrl: 'https://example.com/cancel'
    });
    expect(params.MerchantTradeNo).toBe('EC20260515ABCDE');
    expect(params.TotalAmount).toBe(1680);
    expect(params.PaymentType).toBe('aio');
    expect(params.EncryptType).toBe(1);
    expect(params.ItemName).toBe('粉色玫瑰花束 x1');
    expect(ecpay.verifyCheckMacValue(params)).toBe(true);
  });

  it('queryTradeInfo signs request and verifies response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opts) => {
      const params = Object.fromEntries(new URLSearchParams(opts.body));
      // Echo a TradeStatus=0 (未付款) response signed with the same key
      const respPayload = {
        MerchantID: params.MerchantID,
        MerchantTradeNo: params.MerchantTradeNo,
        TradeNo: '',
        TradeAmt: '0',
        PaymentDate: '',
        PaymentType: '',
        HandlingCharge: '0',
        PaymentTypeChargeFee: '0',
        TradeDate: '',
        TradeStatus: '0',
        ItemName: ''
      };
      respPayload.CheckMacValue = ecpay.generateCheckMacValue(respPayload);
      const body = new URLSearchParams(respPayload).toString();
      return { ok: true, status: 200, text: async () => body };
    });

    const result = await ecpay.queryTradeInfo('EC1234567890');
    expect(result.TradeStatus).toBe('0');
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, opts] = fetchSpy.mock.calls[0];
    const sent = Object.fromEntries(new URLSearchParams(opts.body));
    expect(sent.MerchantTradeNo).toBe('EC1234567890');
    expect(sent.CheckMacValue).toBe(ecpay.generateCheckMacValue({
      MerchantID: sent.MerchantID,
      MerchantTradeNo: sent.MerchantTradeNo,
      TimeStamp: sent.TimeStamp
    }));
    fetchSpy.mockRestore();
  });

  it('queryTradeInfo throws on tampered response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const body = new URLSearchParams({
        MerchantID: '3002607',
        MerchantTradeNo: 'EC1234567890',
        TradeStatus: '1',
        CheckMacValue: 'WRONG'
      }).toString();
      return { ok: true, status: 200, text: async () => body };
    });
    await expect(ecpay.queryTradeInfo('EC1234567890')).rejects.toThrow(/驗章失敗/);
    fetchSpy.mockRestore();
  });
});
