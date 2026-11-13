// POST /api/track-purchase-invoice  →  { eventId }
// Серверна відправка Purchase у Meta CAPI для оплат через "Соціальний
// інвойс" WayForPay — окрему сторінку на боці WayForPay, у якої немає поля
// Service URL, тому payment-callback.js для таких оплат ніколи не
// викликається. Викликається зі сторінки thank-you.html (Return URL цього
// інвойсу), з тим самим event_id, що й клієнтська fbq()-подія на тій же
// сторінці — для дедуплікації в Meta Events Manager.
//
// На відміну від payment-callback.js, тут немає підпису WayForPay для
// перевірки (Return URL — звичайний GET-редірект без серверного
// підтвердження), тому цю подію не можна вважати так само надійно
// верифікованою. Це свідомий компроміс: краще трохи менш надійний Purchase,
// ніж жодного.

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
          event_name: 'Purchase',
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId || undefined,
          action_source: 'website',
          event_source_url: `${SITE_URL || ''}/thank-you.html`,
          user_data: {
            client_ip_address: clientIp || undefined,
            client_user_agent: userAgent || undefined,
          },
          custom_data: { value: 1900, currency: 'UAH' },
        }],
      }),
    });
    // Meta повертає 200 навіть на невалідний запит (помилка — в тілі), тому
    // логуємо відповідь завжди, а не лише при мережевому збої fetch.
    const fbText = await fbRes.text();
    console.log(`Meta CAPI Purchase (invoice relay): HTTP ${fbRes.status} — ${fbText}`);
  } catch (e) {
    console.error('Meta CAPI Purchase (invoice relay) failed', e);
  }

  return { statusCode: 200, body: '{}' };
};
