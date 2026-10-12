// POST /.netlify/functions/payment-callback  — WayForPay "serviceUrl" (server-to-server).
// 1) перевіряє підпис вхідного колбека, 2) ідемпотентно позначає замовлення оплаченим,
// 3) видає PDF на пошту (лист містить і пряме посилання, і кнопку Telegram-бота),
// 4) шле серверну подію Purchase у Meta CAPI,
// 5) ЗАВЖДИ відповідає підписаним accept-об'єктом — інакше WayForPay ретраїть запит.

const crypto = require('crypto');
const { store } = require('./_lib/blobs');
const { wfpSignature } = require('./_lib/wfp');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const {
    WFP_MERCHANT_SECRET, SITE_URL, RESEND_API_KEY, RESEND_FROM_EMAIL,
    META_PIXEL_ID, META_CAPI_TOKEN, TELEGRAM_BOT_USERNAME,
  } = process.env;

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Bad JSON' };
  }

  const {
    merchantAccount, orderReference, amount, currency,
    authCode, cardPan, transactionStatus, reasonCode,
    merchantSignature, email: payerEmail,
  } = payload;

  function respond(statusText) {
    const time = Math.floor(Date.now() / 1000);
    const signature = wfpSignature(WFP_MERCHANT_SECRET, [orderReference, statusText, time]);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderReference, status: statusText, time, signature }),
    };
  }

  if (!orderReference || !WFP_MERCHANT_SECRET) {
    return respond('accept');
  }

  // Перевірка автентичності запиту — інакше будь-хто міг би "підтвердити" оплату сам.
  const expectedSignature = wfpSignature(WFP_MERCHANT_SECRET, [
    merchantAccount, orderReference, amount, currency,
    authCode, cardPan, transactionStatus, reasonCode,
  ]);
  const signatureValid = expectedSignature.toLowerCase() === String(merchantSignature || '').toLowerCase();

  if (!signatureValid) {
    console.error('WFP callback: invalid signature', orderReference);
    return respond('accept');
  }

  const ordersStore = store('orders');
  let order = await ordersStore.get(orderReference, { type: 'json' });

  // Замовлення могло не існувати в нашому сховищі — якщо оплата пройшла через
  // готову платіжну кнопку/посилання з кабінету WayForPay (без нашого
  // create-payment.js). У такому разі створюємо запис прямо тут, узявши email
  // покупця з самого колбека (WayForPay передає його в полі "email").
  if (!order) {
    order = {
      email: String(payerEmail || '').trim().toLowerCase(),
      status: 'pending',
      amount,
      currency,
      createdAt: new Date().toISOString(),
    };
  }

  if (!order.email) {
    console.error('WFP callback: немає email покупця, лист не буде надіслано', orderReference);
  }

  // Ідемпотентність: повторний колбек на вже оброблене замовлення нічого не робить повторно.
  if (order.status === 'paid') {
    return respond('accept');
  }

  if (transactionStatus === 'Approved') {
    const downloadToken = crypto.randomBytes(24).toString('hex');
    await ordersStore.setJSON(orderReference, {
      ...order,
      status: 'paid',
      transactionStatus,
      paidAt: new Date().toISOString(),
      downloadToken,
    });

    const downloadUrl = `${SITE_URL}/.netlify/functions/download-guide?token=${downloadToken}`;
    // Бот не може написати першим у Telegram за нікнеймом (обмеження Bot API) —
    // тому доставка йде через deep-link "?start=токен": людина сама тисне кнопку,
    // відкривається чат із ботом, і той одразу надсилає файл (telegram-webhook.js).
    const telegramUrl = TELEGRAM_BOT_USERNAME
      ? `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${downloadToken}`
      : null;

    if (RESEND_API_KEY && RESEND_FROM_EMAIL && order.email) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: RESEND_FROM_EMAIL,
            to: order.email,
            subject: 'Ваш гайд з контролю реклами',
            html: `
              <div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:24px;color:#2A231E;">
                <p>Дякуємо за покупку!</p>
                <p>Ваш PDF готовий. Завантажте його за посиланням нижче (дійсне 7 днів):</p>
                <p><a href="${downloadUrl}" style="color:#40302A;">${downloadUrl}</a></p>
                ${telegramUrl ? `
                <p>Або отримайте миттєво в Telegram:</p>
                <p><a href="${telegramUrl}" style="display:inline-block;background:#40302A;color:#FBF8F3;padding:12px 20px;border-radius:999px;text-decoration:none;">Відкрити в Telegram</a></p>
                ` : ''}
                <p style="color:#7A6E62;font-size:13px;">Якщо посилання не відкривається — відповідьте на цей лист.</p>
              </div>
            `,
          }),
        });
      } catch (e) {
        console.error('Resend email failed', e);
      }
    } else {
      console.error(
        !order.email
          ? `Немає email покупця — лист не надіслано, orderReference=${orderReference}`
          : `RESEND_API_KEY / RESEND_FROM_EMAIL не задані — лист не надіслано, orderReference=${orderReference}`
      );
    }

    if (META_PIXEL_ID && META_CAPI_TOKEN && order.email) {
      try {
        const emailHash = crypto.createHash('sha256').update(order.email.trim().toLowerCase()).digest('hex');
        const fbRes = await fetch(`https://graph.facebook.com/v20.0/${META_PIXEL_ID}/events?access_token=${META_CAPI_TOKEN}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: [{
              event_name: 'Purchase',
              event_time: Math.floor(Date.now() / 1000),
              event_id: order.purchaseEventId || undefined,
              action_source: 'website',
              event_source_url: `${SITE_URL}/`,
              user_data: { em: [emailHash] },
              custom_data: { value: Number(amount), currency },
            }],
          }),
        });
        // Meta повертає 200 навіть на невалідний запит (помилка — в тілі),
        // тому логуємо відповідь завжди, а не лише при мережевому збої fetch.
        const fbText = await fbRes.text();
        console.log(`Meta CAPI Purchase: HTTP ${fbRes.status} — ${fbText}`);
      } catch (e) {
        console.error('Meta CAPI Purchase failed', e);
      }
    }
  } else {
    await ordersStore.setJSON(orderReference, { ...order, status: 'failed', transactionStatus });
  }

  return respond('accept');
};
