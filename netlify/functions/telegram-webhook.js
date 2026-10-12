// POST /.netlify/functions/telegram-webhook — вебхук Telegram-бота.
// Обробляє лише команду "/start <token>" (deep-link із листа після оплати,
// див. payment-callback.js): шукає оплачене замовлення за токеном і одразу
// надсилає PDF у чат. Важливо: бот НЕ вміє писати першим людині за нікнеймом —
// це обмеження Telegram Bot API, тому весь потік ініціює сама людина кліком
// по посиланню "https://t.me/BOT_USERNAME?start=TOKEN".
//
// Налаштування вебхука (одноразово, після деплою) — див. README-PAYMENTS.md:
// curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<SITE_URL>/.netlify/functions/telegram-webhook"

const { store } = require('./_lib/blobs');

async function findOrderByToken(token) {
  const ordersStore = store('orders');
  const { blobs } = await ordersStore.list();
  for (const { key } of blobs) {
    const candidate = await ordersStore.get(key, { type: 'json' });
    if (candidate && candidate.downloadToken === token && candidate.status === 'paid') {
      return candidate;
    }
  }
  return null;
}

async function sendTelegramMessage(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function sendTelegramDocument(token, chatId, pdfBuffer, filename) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([pdfBuffer], { type: 'application/pdf' }), filename);
  await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: form,
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { TELEGRAM_BOT_TOKEN } = process.env;
  if (!TELEGRAM_BOT_TOKEN) {
    // Токен не налаштований — тихо ігноруємо, щоб Telegram не ретраїв вебхук.
    return { statusCode: 200, body: 'ok' };
  }

  let update;
  try {
    update = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 200, body: 'ok' };
  }

  const message = update.message;
  const text = message && message.text;
  const chatId = message && message.chat && message.chat.id;

  if (!chatId || !text || !text.startsWith('/start')) {
    return { statusCode: 200, body: 'ok' };
  }

  const token = text.replace('/start', '').trim();

  if (!token) {
    await sendTelegramMessage(
      TELEGRAM_BOT_TOKEN,
      chatId,
      'Привіт! Щоб отримати файл, скористайтеся посиланням із листа після оплати.'
    );
    return { statusCode: 200, body: 'ok' };
  }

  const order = await findOrderByToken(token);

  if (!order) {
    await sendTelegramMessage(
      TELEGRAM_BOT_TOKEN,
      chatId,
      'Посилання недійсне або застаріле. Напишіть нам, якщо оплата пройшла, — надішлемо файл вручну.'
    );
    return { statusCode: 200, body: 'ok' };
  }

  const paidAt = new Date(order.paidAt).getTime();
  if (Date.now() - paidAt > 7 * 24 * 60 * 60 * 1000) {
    await sendTelegramMessage(
      TELEGRAM_BOT_TOKEN,
      chatId,
      'Термін дії посилання минув (7 днів). Напишіть нам — надішлемо файл повторно.'
    );
    return { statusCode: 200, body: 'ok' };
  }

  const filesStore = store('files');
  const pdf = await filesStore.get('guide.pdf', { type: 'arrayBuffer' });

  if (!pdf) {
    await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, 'Файл тимчасово недоступний. Зверніться до підтримки.');
    return { statusCode: 200, body: 'ok' };
  }

  try {
    await sendTelegramDocument(TELEGRAM_BOT_TOKEN, chatId, pdf, 'skrypt-prodazhiv.pdf');
  } catch (e) {
    console.error('Telegram sendDocument failed', e);
    await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, 'Не вдалося надіслати файл. Спробуйте ще раз трохи пізніше.');
  }

  return { statusCode: 200, body: 'ok' };
};
