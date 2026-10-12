// GET /.netlify/functions/download-guide?token=...
// Видає PDF лише за дійсним токеном, виданим після підтвердженої оплати
// (payment-callback.js). PDF зберігається окремим Blob-store "files" —
// завантажте його один раз через Netlify CLI (див. README-PAYMENTS.md).

const { store } = require('./_lib/blobs');

exports.handler = async (event) => {
  const token = event.queryStringParameters && event.queryStringParameters.token;
  if (!token) {
    return { statusCode: 400, body: 'Відсутній token' };
  }

  const ordersStore = store('orders');

  // Лінійний пошук за токеном серед замовлень.
  // Для об'ємів tripwire-лендингу (десятки/сотні замовлень на день) — достатньо.
  // При зростанні варто завести окремий store "tokens": token -> orderReference.
  const { blobs } = await ordersStore.list();
  let order = null;
  for (const { key } of blobs) {
    const candidate = await ordersStore.get(key, { type: 'json' });
    if (candidate && candidate.downloadToken === token && candidate.status === 'paid') {
      order = candidate;
      break;
    }
  }

  if (!order) {
    return { statusCode: 403, body: 'Посилання недійсне або застаріле. Напишіть нам, якщо оплата пройшла.' };
  }

  // Термін дії посилання — 7 днів від оплати.
  const paidAt = new Date(order.paidAt).getTime();
  if (Date.now() - paidAt > 7 * 24 * 60 * 60 * 1000) {
    return { statusCode: 403, body: 'Термін дії посилання минув. Напишіть нам — надішлемо гайд повторно.' };
  }

  const filesStore = store('files');
  const pdf = await filesStore.get('guide.pdf', { type: 'arrayBuffer' });

  if (!pdf) {
    return { statusCode: 500, body: 'PDF ще не завантажено на сервер. Зверніться до адміністратора сайту.' };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="skrypt-prodazhiv.pdf"',
      'Cache-Control': 'private, no-store',
    },
    body: Buffer.from(pdf).toString('base64'),
    isBase64Encoded: true,
  };
};
