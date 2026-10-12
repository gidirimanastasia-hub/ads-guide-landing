// POST /api/track-initiate-checkout  →  { eventId }
// Дублює InitiateCheckout серверно в Meta CAPI — стійко до блокувальників
// реклами, які могли б з'їсти клієнтську подію fbq(). Викликається з
// script.js через fetch(..., { keepalive: true }) прямо перед переходом
// на WayForPay, з тим самим event_id, що й у клієнтській fbq()-події —
// для дедуплікації в Meta Events Manager.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { SITE_URL, META_PIXEL_ID, META_CAPI_TOKEN } = process.env;

  if (!META_PIXEL_ID || !META_CAPI_TOKEN) {
    // Тихо ігноруємо — трекінг не налаштований, це не помилка користувача.
    return { statusCode: 200, body: '{}' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: '{}' };
  }

  const eventId = String(body.eventId || '');
  const clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'];
  const userAgent = event.headers['user-agent'];

  try {
    const fbRes = await fetch(`https://graph.facebook.com/v20.0/${META_PIXEL_ID}/events?access_token=${META_CAPI_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [{
          event_name: 'InitiateCheckout',
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId || undefined,
          action_source: 'website',
          event_source_url: `${SITE_URL || ''}/`,
          user_data: {
            client_ip_address: clientIp || undefined,
            client_user_agent: userAgent || undefined,
          },
          custom_data: { value: 900, currency: 'UAH' },
        }],
      }),
    });
    // Meta повертає 200 навіть на невалідний запит (помилка — в тілі), тому
    // логуємо відповідь завжди, а не лише при мережевому збої fetch.
    const fbText = await fbRes.text();
    console.log(`Meta CAPI InitiateCheckout (relay): HTTP ${fbRes.status} — ${fbText}`);
  } catch (e) {
    console.error('Meta CAPI InitiateCheckout (relay) failed', e);
  }

  return { statusCode: 200, body: '{}' };
};
