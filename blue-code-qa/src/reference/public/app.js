(() => {
  'use strict';
  const page = document.body.dataset.page;
  let csrf = null;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'text') n.textContent = v; // never innerHTML: all dynamic output is text
      else if (k === 'class') n.className = v;
      else n.setAttribute(k, v);
    }
    for (const kid of kids) n.append(kid);
    return n;
  }
  function safeNext(next, fallback) {
    if (!next || !/^\/[A-Za-z0-9/_\-.?=&%]*$/.test(next) || next.startsWith('//') || next.includes('\\')) return fallback;
    return next;
  }
  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.method && opts.method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
    const res = await fetch(path, { method: opts.method || 'GET', headers, credentials: 'same-origin', body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.error && data.error.message) || 'Something went wrong. Please try again.');
      err.status = res.status;
      err.code = data && data.error && data.error.code;
      err.fields = data && data.error && data.error.fields;
      throw err;
    }
    return data;
  }
  async function currentUser() {
    try { const d = await api('/api/auth/me'); csrf = d.csrfToken; return d.user; } catch { return null; }
  }
  function showError(err) {
    const box = document.getElementById('form-error');
    if (!box) return;
    let msg = err.message;
    if (err.fields && err.fields.length) msg += ' (' + err.fields.map((f) => f.path + ': ' + f.reason).join('; ') + ')';
    box.textContent = msg;
  }
  const formData = (form) => Object.fromEntries(new FormData(form).entries());
  const fmtDate = (iso) => new Date(iso).toISOString().slice(0, 10);

  function renderNav(user) {
    const nav = document.getElementById('nav');
    nav.textContent = '';
    nav.append(el('a', { href: '/pricing', text: 'Pricing' }));
    if (user) {
      nav.append(el('a', { href: '/dashboard', 'data-testid': 'nav-dashboard', text: 'Dashboard' }));
      const b = el('button', { type: 'button', class: 'alt', 'data-testid': 'logout', text: 'Log out' });
      b.addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST' }); } finally { location.assign('/'); } });
      nav.append(b);
    } else {
      nav.append(el('a', { href: '/login', text: 'Log in' }), el('a', { href: '/register', text: 'Register' }));
    }
  }

  async function requireUser() {
    const user = await currentUser();
    if (!user) { location.assign('/login?next=' + encodeURIComponent(location.pathname + location.search)); return null; }
    return user;
  }

  const pages = {
    index() {},
    register() {
      document.getElementById('register-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api('/api/auth/register', { method: 'POST', body: formData(e.target) }); location.assign('/login?registered=1'); }
        catch (err) { showError(err); }
      });
    },
    login() {
      const p = new URLSearchParams(location.search);
      if (p.get('registered')) document.getElementById('notice').textContent = 'Account created. Please sign in.';
      document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const d = await api('/api/auth/login', { method: 'POST', body: formData(e.target) });
          csrf = d.csrfToken;
          location.assign(safeNext(p.get('next'), '/pricing'));
        } catch (err) { showError(err); }
      });
    },
    async pricing() {
      try {
        const { plans } = await api('/api/plans');
        const wrap = document.getElementById('plans');
        for (const pl of plans) {
          wrap.append(el('div', { class: 'plan', 'data-testid': 'plan-' + pl.id },
            el('h3', { text: pl.name }),
            el('p', { text: '₹' + pl.amount + ' / ' + pl.interval }),
            el('a', { class: 'btn', href: '/checkout?plan=' + encodeURIComponent(pl.id), 'data-testid': 'select-' + pl.id, text: 'Select plan' })));
        }
      } catch (err) { showError(err); }
    },
    async checkout(user) {
      const planId = new URLSearchParams(location.search).get('plan') || '';
      const { plans } = await api('/api/plans');
      const plan = plans.find((x) => x.id === planId);
      if (!plan) { document.getElementById('form-error').textContent = 'The selected plan is not available.'; document.getElementById('pay').disabled = true; return; }
      document.getElementById('s-plan').textContent = plan.name;
      document.getElementById('s-amount').textContent = '₹' + plan.amount;
      const form = document.getElementById('checkout-form');
      form.elements.firstname.value = user.name.split(' ')[0] || '';
      form.elements.email.value = user.email;
      // The key lives in memory for THIS page load only (covers double-clicks and network retries). Back/refresh are covered by the
      // server's open-order reuse. Persisting it across page loads caused DEF-004 (stale key re-issuing a closed order).
      let key = crypto.randomUUID();
      let submitting = false;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (submitting) return; // double-click guard (server-side idempotency is the real protection)
        submitting = true;
        const btn = document.getElementById('pay');
        btn.disabled = true;
        try {
          const r = await api('/api/payments/checkout', { method: 'POST', headers: { 'Idempotency-Key': key }, body: { planId, customer: formData(form) } });
          const f = el('form', { method: 'POST', action: r.payu.action });
          for (const [k, v] of Object.entries(r.payu.fields)) f.append(el('input', { type: 'hidden', name: k, value: v }));
          document.body.append(f);
          f.submit();
        } catch (err) {
          if (err.code === 'IDEMPOTENCY_KEY_USED') key = crypto.randomUUID();
          showError(err); submitting = false; btn.disabled = false;
        }
      });
    },
    async result() {
      const status = document.getElementById('status');
      const details = document.getElementById('details');
      const recheck = document.getElementById('recheck');
      const orderId = new URLSearchParams(location.search).get('order') || '';
      // NOTE: any ?status=... in the URL is deliberately ignored. Only the authenticated API is trusted.
      if (!UUID.test(orderId)) { status.textContent = 'We could not find this payment.'; status.dataset.status = 'notfound'; return; }
      const MESSAGES = {
        success: 'Payment confirmed. Your subscription is active.',
        failed: 'Payment failed. You have not been charged. Please try again.',
        cancelled: 'Payment cancelled. You have not been charged.',
        expired: 'This payment session expired. Please start again.',
        pending: 'We are confirming your payment. This can take a minute.',
      };
      function render(o) {
        status.textContent = MESSAGES[o.status] || 'Unknown status';
        status.dataset.status = o.status;
        details.textContent = '';
        details.append(el('dt', { text: 'Reference' }), el('dd', { 'data-testid': 'ref', text: o.reference }), el('dt', { text: 'Plan' }), el('dd', { text: o.planName }), el('dt', { text: 'Amount' }), el('dd', { text: '₹' + o.amount }));
        recheck.hidden = o.status !== 'pending';
      }
      async function load(refresh) {
        const d = refresh ? await api('/api/payments/' + orderId + '/refresh', { method: 'POST' }) : await api('/api/payments/' + orderId);
        render(d.order);
        return d.order;
      }
      try {
        let o = await load(false);
        for (let i = 0; i < 3 && o.status === 'pending'; i++) { await new Promise((r) => setTimeout(r, 1500)); o = await load(true); }
      } catch (err) {
        status.textContent = err.status === 404 ? 'We could not find this payment.' : err.message;
        status.dataset.status = err.status === 404 ? 'notfound' : 'error';
      }
      recheck.addEventListener('click', () => load(true).catch((e) => { status.textContent = e.message; }));
    },
    async dashboard(user) {
      document.getElementById('who').textContent = user.name;
      const [sub, pay] = await Promise.all([api('/api/subscription'), api('/api/payments?pageSize=50')]);
      const cur = sub.current;
      document.getElementById('current-plan').textContent = cur ? 'Active plan: ' + cur.planId : 'No active subscription';
      document.getElementById('current-plan').dataset.planId = cur ? cur.planId : '';
      document.getElementById('current-expiry').textContent = cur ? 'Renews/expires on ' + fmtDate(cur.expiresAt) : '';
      const sr = document.getElementById('sub-rows');
      for (const s of sub.history) sr.append(el('tr', {}, el('td', { text: s.planId }), el('td', { text: fmtDate(s.startsAt) }), el('td', { text: fmtDate(s.expiresAt) }), el('td', { text: s.status })));
      const pr = document.getElementById('pay-rows');
      for (const p of pay.items) pr.append(el('tr', {}, el('td', { text: p.reference }), el('td', { text: p.planName }), el('td', { text: '₹' + p.amount }), el('td', { text: p.status })));
    },
  };

  (async () => {
    const needsUser = page === 'checkout' || page === 'dashboard' || page === 'result';
    const user = await currentUser();
    renderNav(user);
    if (needsUser && !user) { location.assign('/login?next=' + encodeURIComponent(location.pathname + location.search)); return; }
    try { await pages[page](user); } catch (err) { showError(err); }
  })();
})();
