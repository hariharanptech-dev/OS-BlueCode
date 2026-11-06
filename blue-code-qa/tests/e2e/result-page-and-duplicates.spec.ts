import { test, expect, type Request } from '@playwright/test';
import { signUpAndLogin, toCheckout, payAndChoose, backendOrder, backendSubscription, register, login, newEmail } from './helpers.ts';

test.describe('E2E-5 refreshing the payment-result page', () => {
  test('status stays correct across reloads (success)', async ({ page }) => {
    await signUpAndLogin(page, 'Asha Rao', 't5'); await toCheckout(page); const orderId = await payAndChoose(page, 'success');
    for (let i = 0; i < 3; i++) { await page.reload(); await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', 'success'); }
    expect((await backendSubscription(page)).history).toHaveLength(1); expect((await backendOrder(page, orderId)).body.order.status).toBe('success');
  });
  test('status stays correct across reloads (failure)', async ({ page }) => {
    await signUpAndLogin(page, 'Asha Rao', 't5b'); await toCheckout(page, 'starter_monthly'); await payAndChoose(page, 'fail');
    await page.reload(); await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', 'failed');
    await page.reload(); await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', 'failed');
    // NOTE (see E2E_TEST_REPORT.md, observation O-1): pressing the browser Back button after a payment lands on a non-cacheable POST page (ERR_CACHE_MISS). Safe, but not friendly.
  });
  test('a forged ?status=success in the URL cannot turn a FAILED payment into a success', async ({ page }) => {
    await signUpAndLogin(page, 'Asha Rao', 't5c'); await toCheckout(page, 'starter_monthly'); const orderId = await payAndChoose(page, 'fail');
    await page.goto(`/payment/result?order=${orderId}&status=success&payment=success`); await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', 'failed');
    expect((await backendSubscription(page)).history).toHaveLength(0);
  });
  test('a forged success redirect for an UNPAID (pending) order shows pending and activates nothing', async ({ page }) => {
    await signUpAndLogin(page, 'Asha Rao', 't5d'); await toCheckout(page, 'pro_monthly'); await page.getByTestId('pay-button').click(); await expect(page.getByTestId('mock-txnid')).toBeVisible(); // customer abandons on the PayU page
    const orders = await (await page.request.get('/api/payments')).json(); const orderId = orders.items[0].id;
    await page.goto(`/payment/result?order=${orderId}&status=success`); await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', 'pending', { timeout: 15_000 });
    await expect(page.getByTestId('payment-status')).not.toContainText('Your subscription is active'); expect((await backendSubscription(page)).history).toHaveLength(0);
  });
  test('result page handles malformed order ids safely', async ({ page }) => {
    await signUpAndLogin(page, 'Asha Rao', 't5e');
    for (const bad of ['abc', "1' OR '1'='1", '../../etc/passwd', '']) { await page.goto(`/payment/result?order=${encodeURIComponent(bad)}`); await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', 'notfound'); }
  });
});

test.describe('E2E-6 duplicate payment attempts (idempotency)', () => {
  test('double-clicking Pay creates one order; replayed callbacks never create a second subscription', async ({ page }) => {
    await signUpAndLogin(page, 'Asha Rao', 't6'); await toCheckout(page, 'pro_monthly');
    const checkoutCalls: Request[] = []; const callbackCalls: Request[] = [];
    page.on('request', (r) => { if (r.url().endsWith('/api/payments/checkout')) checkoutCalls.push(r); if (r.url().endsWith('/api/payments/payu/callback') && r.method() === 'POST') callbackCalls.push(r); });
    await page.getByTestId('pay-button').dblclick(); await expect(page.getByTestId('mock-txnid')).toBeVisible();
    expect(checkoutCalls.length).toBe(1); // UI guard
    expect((await (await page.request.get('/api/payments')).json()).total).toBe(1);

    // bypass the UI guard: hammer the API directly, in parallel, with the real CSRF token
    const { csrfToken } = await (await page.request.get('/api/auth/me')).json(); const orderId = (await (await page.request.get('/api/payments')).json()).items[0].id;
    const body = { planId: 'pro_monthly', customer: { firstname: 'Asha', email: (await (await page.request.get('/api/auth/me')).json()).user.email, phone: '9876543210' } };
    const rs = await Promise.all(Array.from({ length: 8 }, () => page.request.post('/api/payments/checkout', { data: body, headers: { 'X-CSRF-Token': csrfToken } })));
    const ids = new Set<string>(); for (const r of rs) ids.add((await r.json()).orderId); expect([...ids]).toEqual([orderId]);
    expect((await (await page.request.get('/api/payments')).json()).total).toBe(1);

    await page.getByTestId('mock-pay-success').click(); await page.waitForURL(/\/payment\/result/); await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', 'success');
    expect(callbackCalls.length).toBeGreaterThanOrEqual(1); const payload = Object.fromEntries(new URLSearchParams(callbackCalls[0]!.postData() ?? ''));
    expect(payload['hash']).toBeTruthy();
    const replays = await Promise.all(Array.from({ length: 10 }, () => page.request.post('/api/payments/payu/callback', { form: payload, maxRedirects: 0 })));
    for (const r of replays) expect(r.status()).toBe(303);
    const sub = await backendSubscription(page); expect(sub.history).toHaveLength(1); expect((await backendOrder(page, orderId)).body.order.status).toBe('success');
    const tampered = await page.request.post('/api/payments/payu/callback', { form: { ...payload, amount: '1.00' }, maxRedirects: 0 }); expect(tampered.status()).toBe(400);
    expect((await backendSubscription(page)).history).toHaveLength(1);
  });
  test('buying the same plan again while a subscription is active is refused with a friendly message', async ({ page }) => {
    await signUpAndLogin(page, 'Asha Rao', 't6b'); await toCheckout(page, 'starter_monthly'); await payAndChoose(page, 'success');
    await toCheckout(page, 'starter_monthly'); await page.getByTestId('pay-button').click();
    await expect(page.getByTestId('form-error')).toContainText('already have an active subscription'); await expect(page.getByTestId('pay-button')).toBeEnabled();
    expect((await (await page.request.get('/api/payments')).json()).total).toBe(1);
  });
});

test.describe('E2E-7 unauthorised access to another customer’s information', () => {
  test('customer B cannot see or act on customer A’s payment, subscription or history', async ({ page, browser }) => {
    await signUpAndLogin(page, 'Alice Customer', 't7a'); await toCheckout(page, 'pro_monthly'); const aOrder = await payAndChoose(page, 'success');
    const aOrderBody = (await backendOrder(page, aOrder)).body.order;
    const ctxB = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' }); const b = await ctxB.newPage();
    try {
      const emailB = newEmail('t7b'); await register(b, 'Bob Customer', emailB); await login(b, emailB); await expect(b).toHaveURL(/\/pricing$/);
      const direct = await backendOrder(b, aOrder); expect(direct.status).toBe(404); expect(JSON.stringify(direct.body)).not.toContain(aOrderBody.reference);
      const refresh = await b.request.post(`/api/payments/${aOrder}/refresh`, { headers: { 'X-CSRF-Token': (await (await b.request.get('/api/auth/me')).json()).csrfToken } }); expect(refresh.status()).toBe(404);
      await b.goto(`/payment/result?order=${aOrder}`); await expect(b.getByTestId('payment-status')).toHaveAttribute('data-status', 'notfound'); await expect(b.locator('body')).not.toContainText(aOrderBody.reference);
      await b.goto('/dashboard'); await expect(b.getByTestId('who')).toHaveText('Bob Customer'); await expect(b.getByTestId('current-plan')).toHaveText('No active subscription'); await expect(b.getByTestId('pay-rows').locator('tr')).toHaveCount(0);
      expect((await (await b.request.get(`/api/subscription?userId=anything`)).json()).history).toHaveLength(0);
    } finally { await ctxB.close(); }
    const stillA = await backendOrder(page, aOrder); expect(stillA.body.order.status).toBe('success');
  });
  test('after logout the old session cannot reach protected data, and the browser history cannot re-expose it', async ({ page }) => {
    await signUpAndLogin(page, 'Asha Rao', 't7c'); await page.goto('/dashboard'); await expect(page.getByTestId('who')).toBeVisible();
    await page.getByTestId('logout').click(); await expect(page).toHaveURL(/\/$/); expect((await page.request.get('/api/subscription')).status()).toBe(401);
    await page.goBack(); await expect(page).toHaveURL(/\/login\?next=/);
  });
});
