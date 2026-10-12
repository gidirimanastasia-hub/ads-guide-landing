document.addEventListener('DOMContentLoaded', () => {

  /* ---------- FAQ accordion: один відкритий пункт, перший — за замовчуванням ---------- */
  const faqItems = Array.from(document.querySelectorAll('.faq-item'));
  let openIndex = 0;

  function renderFaq() {
    faqItems.forEach((item, i) => {
      const question = item.querySelector('[data-faq-toggle]');
      const answer = item.querySelector('[data-faq-answer]');
      const icon = item.querySelector('[data-faq-icon]');
      const isOpen = i === openIndex;
      question.setAttribute('aria-expanded', String(isOpen));
      answer.classList.toggle('open', isOpen);
      icon.textContent = isOpen ? '–' : '+';
    });
  }

  faqItems.forEach((item, i) => {
    item.querySelector('[data-faq-toggle]').addEventListener('click', () => {
      openIndex = openIndex === i ? -1 : i;
      renderFaq();
    });
  });

  renderFaq();

  /* ---------- Sticky CTA (fab): з'являється після скролу > 660px ---------- */
  const fab = document.getElementById('fab');
  let showFab = false;

  function onScroll() {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    const next = y > 660;
    if (next !== showFab) {
      showFab = next;
      fab.classList.toggle('show', showFab);
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Оплата: готова кнопка/посилання з кабінету WayForPay ----------
     Самі кнопки (data-wfp-buy) — прямі посилання/форма з кабінету WFP, підпис
     і оформлення оплати WayForPay бере на себе. Тут лише трекінг кліку:
     клієнтський Pixel + серверне дублювання в Meta CAPI з тим самим
     event_id (для дедуплікації, стійкості до блокувальників реклами). */
  function genId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  document.querySelectorAll('[data-wfp-buy]').forEach((el) => {
    el.addEventListener('click', () => {
      const eventId = genId();

      if (window.fbq) {
        fbq('track', 'InitiateCheckout', { value: 900, currency: 'UAH' }, { eventID: eventId });
      }

      try {
        fetch('/api/track-initiate-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId }),
          keepalive: true, // запит переживе перехід на secure.wayforpay.com
        });
      } catch (e) {
        // мовчки ігноруємо — трекінг не має блокувати перехід до оплати
      }
    });
  });

});
