const { createApp, ref, onMounted } = Vue;

createApp({
  setup() {
    if (!Auth.requireAuth()) return {};

    const el = document.getElementById('app');
    const orderId = el.dataset.orderId;
    const paymentResult = ref(el.dataset.paymentResult || null);

    const order = ref(null);
    const loading = ref(true);
    const paying = ref(false);
    const querying = ref(false);

    const statusMap = {
      pending: { label: '待付款', cls: 'bg-apricot/20 text-apricot' },
      paid: { label: '已付款', cls: 'bg-sage/20 text-sage' },
      failed: { label: '付款失敗', cls: 'bg-red-100 text-red-600' },
    };

    const paymentMessages = {
      success: { text: '付款成功！感謝您的購買。', cls: 'bg-sage/10 text-sage border border-sage/20' },
      failed: { text: '付款失敗或交易未成立，請重試。', cls: 'bg-red-50 text-red-600 border border-red-100' },
      cancel: { text: '付款已取消。', cls: 'bg-apricot/10 text-apricot border border-apricot/20' },
      pending: { text: '尚未收到綠界付款回應，可稍後再次點擊「主動查詢」確認。', cls: 'bg-apricot/10 text-apricot border border-apricot/20' },
    };

    function goEcpay() {
      if (!order.value || paying.value) return;
      paying.value = true;
      window.location.href = '/payment/ecpay/' + order.value.id;
    }

    async function queryPayment() {
      if (!order.value || querying.value) return;
      querying.value = true;
      try {
        const res = await apiFetch('/api/orders/' + order.value.id + '/ecpay-query', {
          method: 'POST'
        });
        order.value = res.data.order;
        const status = res.data.order.status;
        paymentResult.value = status === 'paid' ? 'success'
          : status === 'failed' ? 'failed'
          : 'pending';
        if (status === 'paid') {
          Notification.show('付款成功', 'success');
        } else if (status === 'failed') {
          Notification.show('付款失敗或交易未成立', 'error');
        } else {
          Notification.show('綠界尚未確認付款，請稍候再試', 'info');
        }
      } catch (e) {
        Notification.show(e?.data?.message || '查詢失敗，請稍後重試', 'error');
      } finally {
        querying.value = false;
      }
    }

    onMounted(async function () {
      try {
        const res = await apiFetch('/api/orders/' + orderId);
        order.value = res.data;
        // 從 OrderResultURL 導回時 URL 帶有 ?payment=...，這裡若狀態仍是 pending 自動觸發一次查詢
        if (order.value.status === 'pending' && order.value.ecpay_trade_no && paymentResult.value && paymentResult.value !== 'cancel') {
          queryPayment();
        }
      } catch (e) {
        Notification.show('載入訂單失敗', 'error');
      } finally {
        loading.value = false;
      }
    });

    return { order, loading, paying, querying, paymentResult, statusMap, paymentMessages, goEcpay, queryPayment };
  }
}).mount('#app');
