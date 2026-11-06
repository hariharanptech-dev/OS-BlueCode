import { test, expect } from '@playwright/test';
import { signUpAndLogin, register, login, newEmail, toCheckout, payAndChoose, backendOrder, backendSubscription } from './helpers.ts';

test.describe('E2E-1 registration → login → pricing → plan → checkout', () => {
  test('a new visitor reaches the checkout page for the plan they picked', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('landing-title')).toBeVisible();
    await page.getByTestId('cta-register').click();
    await expect(page).toHaveURL(/\/register$/);
    const email = newEmail('t1');
    await page.getByTestId('reg-name').fill('Meera Nair'); await page.getByTestId('reg-email').fill(email); await page.getByTestId('reg-password').fill('Correct-Horse-42'); await page.getByTestId('reg-submit').click();
    await expect(page).toHaveURL(/\/login\?registered=1/); await expect(page.getByTestId('login-notice')).toContainText('Account created');
    await login(page, email); await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.getByTestId('plans').locator('.plan')).toHaveCount(3);
    await page.getByTestId('select-pro_monthly').click();
    await expect(page).toHaveURL(/\/checkout\?plan=pro_monthly$/);
    await expect(page.getByTestId('summary-plan')).toHaveText('Pro Monthly'); await expect(page.getByTestId('summary-amount')).toHaveText('₹1499.00');
    await expect(page.getByTestId('co-email')).toHaveValue(email);
  });
  test('checkout and dashboard are inaccessible when signed out (redirect to login with a safe return path)', async ({ page }) => {
    await page.goto('/dashboard'); await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
    await page.goto('/checkout?plan=pro_monthly'); await expect(page).toHaveURL(/\/login\?next=/);
  });
  test('invalid registration input shows a clear message without leaking details', async ({ page }) => {
    await page.goto('/register'); await page.getByTestId('reg-name').fill('Asha'); await page.getByTestId('reg-email').fill('not-an-email'); await page.getByTestId('reg-password').fill('short'); await page.getByTestId('reg-submit').click();
    await expect(page.getByTestId('form-error')).toContainText('not valid'); await expect(page.getByTestId('form-error')).not.toContainText(/stack|exception|sql/i);
  });
  test('wrong password shows a generic error', async ({ page }) => {
    const email = newEmail('t1c'); await register(page, 'Asha Rao', email); await login(page, email, 'Wrong-Password-1');
    await expect(page.getByTestId('form-error')).toHaveText('The email or password is incorrect.');
  });
});

test.describe('E2E-2 successful payment', () => {
  test('customer pays; backend verifies; subscription activates exactly once; dashboard reflects it', async ({ page }) => {
    await signUpAndLogin(page, 'Asha Rao', 't2');
    expect((await backendSubscription(page)).current).toBeNull();
    await toCheckout(page, 'pro_monthly');
    await page.getByTestId('pay-button').click();
    await expect(page.getByTestId('mock-amount')).toHaveText('Pay INR 1499.00');
    await page.getByTestId('mock-pay-success').click();
    await page.waitForURL(/\/payment\/result\?order=/);
    const orderId = new URL(page.url()).searchParams.get('order')!;
    await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', 'success');
    await expect(page.getByTestId('payment-status')).toContainText('Your subscription is active');
    const o = await backendOrder(page, orderId); expect(o.status).toBe(200); expect(o.body.order.status).toBe('success'); expect(o.body.order.amount).toBe('1499.00');
    const sub = await backendSubscription(page); expect(sub.current.planId).toBe('pro_monthly'); expect(sub.history).toHaveLength(1);
    await page.getByTestId('to-dashboard').click(); await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('current-plan')).toHaveText('Active plan: pro_monthly'); await expect(page.getByTestId('current-expiry')).toContainText('Renews/expires on');
    await expect(page.getByTestId('pay-rows').locator('tr')).toHaveCount(1); await expect(page.getByTestId('pay-rows')).toContainText('success');
  });
});

test.describe('E2E-3 failed payment', () => {
  test('failure screen is shown and no subscription is activated', async ({ page }) => {
    await signUpAndLogin(page, 'Asha Rao', 't3'); await toCheckout(page, 'starter_monthly');
    const orderId = await payAndChoose(page, 'fail');
    await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', 'failed'); await expect(page.getByTestId('payment-status')).toContainText('You have not been charged');
    expect((await backendOrder(page, orderId)).body.order.status).toBe('failed');
    const sub = await backendSubscription(page); expect(sub.current).toBeNull(); expect(sub.history).toHaveLength(0);
    await page.goto('/dashboard'); await expect(page.getByTestId('current-plan')).toHaveText('No active subscription');
  });
  test('after a failure the customer can try again and succeed', async ({ page }) => {
    await signUpAndLogin(page, 'Asha Rao', 't3b'); await toCheckout(page, 'starter_monthly'); const first = await payAndChoose(page, 'fail');
    await toCheckout(page, 'starter_monthly'); const second = await payAndChoose(page, 'success');
    expect(second).not.toBe(first); await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', 'success'); expect((await backendSubscription(page)).history).toHaveLength(1);
  });
});

test.describe('E2E-4 cancelled payment', () => {
  test('cancellation is recorded as cancelled, never as success', async ({ page }) => {
    await signUpAndLogin(page, 'Asha Rao', 't4'); await toCheckout(page, 'pro_yearly'); const orderId = await payAndChoose(page, 'cancel');
    await expect(page.getByTestId('payment-status')).toHaveAttribute('data-status', 'cancelled'); await expect(page.getByTestId('payment-status')).toContainText('cancelled');
    expect((await backendOrder(page, orderId)).body.order.status).toBe('cancelled'); expect((await backendSubscription(page)).history).toHaveLength(0);
    await page.goto('/dashboard'); await expect(page.getByTestId('pay-rows')).toContainText('cancelled');
  });
});
