# Оплата, трекінг і видача PDF (WayForPay + Meta CAPI + Telegram) — запуск

## Схема

Оплату ініціює **готова кнопка з особистого кабінету WayForPay**
(`https://secure.wayforpay.com/payment/s7194f5517e29`) — кабінет сам формує
коректний підписаний запит, тому наш код ніколи не бачить і не обчислює
`merchantSignature` для запиту на оплату. Секретний ключ мерчанта не потрібен
ні на клієнті, ні для створення платежу.

Netlify Functions лишаються лише для того, що WayForPay сам не робить:
автоматична видача PDF на пошту + в Telegram, і трекінг покупки в Meta.

- `netlify/functions/payment-callback.js` — приймає серверне сповіщення від
  WayForPay після оплати, перевіряє підпис секретним ключем, ідемпотентно
  позначає замовлення оплаченим, шле лист (Resend) із посиланням на PDF **і**
  кнопкою Telegram, та подію `Purchase` в Meta CAPI.
- `netlify/functions/telegram-webhook.js` — приймає команду `/start <токен>`
  від Telegram-бота (людина натискає посилання з листа) і одразу надсилає PDF
  у чат.
- `netlify/functions/track-initiate-checkout.js` — серверне дублювання події
  `InitiateCheckout` (клієнт викликає її через `fetch(..., {keepalive:true})`
  прямо перед переходом на WayForPay).
- `netlify/functions/download-guide.js` — видає PDF за одноразовим токеном
  (посилання діє 7 днів) — запасний варіант, якщо хтось не користується
  Telegram.
- `index.html` / `script.js` — кнопки «Забрати скрипт» вже ведуть на реальну
  кнопку WayForPay на 4 місцях: hero, блок ціни, фінальний екран, плаваюча
  кнопка.

**Важливо про Telegram:** бот технічно не може написати людині першим за
нікнеймом — Telegram Bot API так не працює. Тому файл у Telegram
доставляється через deep-link `t.me/ВАШ_БОТ?start=токен` **у самому листі**:
покупчиня тисне кнопку з пошти → відкривається чат із ботом → бот одразу
надсилає файл. Це і є та «видача в Telegram», яку просив дизайн — просто
ініціює її сама людина одним кліком, а не бот напряму.

---

## Крок 1 — кнопка WayForPay вже вставлена ✅

Посилання `https://secure.wayforpay.com/payment/s7194f5517e29` вставлено в
`href` на всіх 4 місцях (`data-wfp-buy`), наш власний вигляд кнопок
(«таблетка», кольори бренду) збережено — синій прямокутник WFP зі сніпета не
використовували.

**Залишилось перевірити налаштування цієї кнопки в кабінеті WayForPay**
(розділ «Кнопка оплати» / «Платіжні посилання», де ви її створювали):

- **Service URL / URL сповіщень / Callback URL** —
  `https://sales-script-landing.netlify.app/.netlify/functions/payment-callback`
  (якщо поле є лише на рівні мерчант-акаунту — знайдіть його в загальних
  налаштуваннях, це покриє всі платежі одразу).
- **Return URL / URL повернення** —
  `https://sales-script-landing.netlify.app/thank-you.html`.

(Якщо пізніше підключите свій домен замість `sales-script-landing.netlify.app`
— поверніться сюди й оновіть обидва посилання.)

Без цих двох полів оплата працюватиме, але лист із PDF не надійде і подія
Purchase не долетить до Meta.

---

## Крок 2 — Meta Pixel + Conversions API

1. **Events Manager** (business.facebook.com → Events Manager) → оберіть
   піксель (або створіть новий) → скопіюйте **Pixel ID**.
2. Замініть `YOUR_PIXEL_ID` на цей ID у **двох місцях** `index.html`
   (`<script>` з `fbq('init', ...)` і рядок `<noscript>` нижче). Pixel ID не
   секрет, його видно у вихідному коді будь-якого сайту.
3. Там же: **Налаштування → Conversions API → Generate access token** —
   отримаєте `META_CAPI_TOKEN`. Це вже секрет — лише в Netlify env vars.
4. У Netlify додайте `META_PIXEL_ID` і `META_CAPI_TOKEN`
   (Site settings → Environment variables) і передеплойте сайт.
5. Перевірка: Events Manager → **Test Events** → зайдіть на сайт (має
   з'явитись `PageView`/`ViewContent`); натисніть «Забрати скрипт» —
   з'явиться `InitiateCheckout` **двічі** (browser + server) з позначкою
   «Deduplicated»; після тестової оплати — `Purchase` від сервера.

---

## Крок 3 — Telegram-бот

1. У Telegram напишіть **@BotFather** → `/newbot` → дайте ім'я й унікальний
   `username` (обов'язково закінчується на `bot`, наприклад
   `lipinskaya_guide_bot`).
2. BotFather видасть **токен** виду `123456789:AA...` — це `TELEGRAM_BOT_TOKEN`.
3. У Netlify додайте змінні:
   - `TELEGRAM_BOT_TOKEN` — токен від BotFather (секрет).
   - `TELEGRAM_BOT_USERNAME` — username бота без `@` (публічний).
4. Підключіть вебхук — виконайте в терміналі один раз (підставте свій токен):
   ```bash
   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://sales-script-landing.netlify.app/.netlify/functions/telegram-webhook"
   ```
   У відповіді має бути `"ok":true`. (Термінал і `curl` є в macOS за замовчуванням
   — Node.js для цього кроку не потрібен.)
5. Перевірка: перейдіть за посиланням `https://t.me/ВАШ_БОТ?start=test` —
   бот відповість «Посилання недійсне» (бо `test` не є справжнім токеном
   замовлення) — це нормально, головне, що бот **відповідає взагалі**, тобто
   вебхук працює. Реальний токен бот отримає з листа після справжньої оплати.

---

## Крок 4 — Email-розсилка (Resend)

1. Зареєструйтесь на resend.com (є безкоштовний план).
2. Підтвердіть домен відправника (Resend → Domains).
3. Створіть **API key** → `RESEND_API_KEY`.
4. У Netlify додайте `RESEND_API_KEY` і `RESEND_FROM_EMAIL`
   (наприклад `"Kristina Lipinskaya <guide@ваш-домен.com>"`).

---

## Крок 5 — деплой уже налаштовано ✅

Сайт живе на **`https://sales-script-landing.netlify.app`**, задеплоєний
напряму з GitHub-репозиторію `gidirimanastasia-hub/sales-script-landing`
(гілка `main`). Це **окремий, повноцінний** сайт із Functions — не той
статичний прев'ю, що був виклали раніше через Netlify Drop (`dashing-hotteok-…`,
без оплати й трекінгу).

Далі нічого встановлювати не потрібно: кожен `git push` у `main` сам
запускає новий деплой на Netlify. Node.js/npm/Netlify CLI знадобляться лише
якщо захочете вносити зміни в код locally і пушити їх — самі коміти можна
робити прямо на github.com (кнопка «Edit» на файлі), без термінала.

---

## Крок 6 — змінні середовища

У Netlify: **sales-script-landing → Project configuration → Environment
variables** — додайте кожну змінну (значення беріть із кроків вище,
орієнтир — `.env.example` у репозиторії):

- `WFP_MERCHANT_SECRET` — секретний ключ з кабінету WayForPay (перевірка
  підпису вхідного сповіщення про оплату).
- `SITE_URL` — фінальний домен сайту.
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` — крок 4.
- `META_PIXEL_ID`, `META_CAPI_TOKEN` — крок 2.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` — крок 3.

---

## Крок 7 — завантажте PDF-файл

У Netlify: **sales-script-landing → Blobs** (пункт у лівому меню проєкту) →
створіть/відкрийте store з назвою **`files`** → додайте запис (key) —
**`guide.pdf`** — і завантажте туди сам файл `skrypt-prodazhiv.pdf`. Це те
саме сховище, яке читає `download-guide.js` і `telegram-webhook.js`.

---

## Крок 8 — тест

Змінні середовища застосовуються з наступного деплою — після кроку 6
зробіть будь-який `git push` (навіть порожній коміт) або натисніть
**Trigger deploy → Deploy site** в Netlify (Deploys → кнопка вгорі), щоб
підхопити нові значення.

Перед тим як вважати готовим:
1. Пройдіть реальну (або тестову, якщо WayForPay дозволяє для кнопок) оплату
   650 ₴ самостійно.
2. Перевірте лист від Resend (Resend → Logs) — посилання на PDF відкривається,
   кнопка Telegram веде на бота.
3. Натисніть кнопку Telegram із листа — бот повинен одразу надіслати файл.
4. Перевірте Meta Events Manager → Test Events — подія `Purchase` дійшла.
5. Перевірте логи `payment-callback` і `telegram-webhook`
   (`netlify functions:log <назва>` або в дашборді) на помилки.

---

## Що спрощено і можна доробити пізніше

- Пошук замовлення за токеном (у `download-guide.js` і `telegram-webhook.js`)
  — лінійний перебір усіх записів у store `orders`; для десятків/сотень
  замовлень на день — ок.
- Юридичні посилання у футері (`Договір оферти`, `Політика
  конфіденційності`, `Контакти`) ведуть на `#` — замініть на реальні URL
  перед реальним прийомом оплати.
- Якщо в кабінеті WayForPay є вбудована автоматична видача цифрового товару
  — можна покластися на неї для email, лишивши наш код тільки заради
  Telegram і Meta CAPI.
