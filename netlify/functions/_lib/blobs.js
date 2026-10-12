// Обгортка над @netlify/blobs.getStore(), яка обходить відомий баг платформи
// "MissingBlobsEnvironmentError: The environment has not been configured..."
// на частині нових сайтів (автоматичний siteID/token інколи не інжектиться
// в Functions навіть у продакшені — див. форум Netlify, офіційного фіксу немає).
//
// Якщо задані NETLIFY_SITE_ID і NETLIFY_BLOBS_TOKEN — використовуємо явну
// конфігурацію (документований обхідний шлях). Інакше — падаємо назад на
// звичайний zero-config виклик (раптом на цьому сайті автоінжекція таки працює).
const { getStore } = require('@netlify/blobs');

function store(name) {
  const { NETLIFY_SITE_ID, NETLIFY_BLOBS_TOKEN } = process.env;
  if (NETLIFY_SITE_ID && NETLIFY_BLOBS_TOKEN) {
    return getStore({ name, siteID: NETLIFY_SITE_ID, token: NETLIFY_BLOBS_TOKEN });
  }
  return getStore(name);
}

module.exports = { store };
