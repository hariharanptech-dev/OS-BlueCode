import { expect, type Page, type BrowserContext } from '@playwright/test';

export const PASSWORD = 'Correct-Horse-42';
let n = 0;
export const newEmail = (tag = 'e2e'): string => `${tag}.${Date.now().toString(36)}${++n}@example.test`;

export async function register(page: Page, name: string, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/register');
  await page.getByTestId('reg-name').fill(name);
  await page.getByTestId('reg-email').fill(email);
  await page.getByTestId('reg-password').fill(password);
  await page.getByTestId('reg-submit').click();
  await expect(page).toHaveURL(/\/login\?registered=1/);
}

export async function login(page: Page, email: string, password = PASSWORD, next?: string): Promise<void> {
  await page.goto('/login' + (next ? `?next=${encodeURIComponent(next)}` : ''));
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}

export async function signUpAndLogin(page: Page, name = 'Asha Rao', tag = 'e2e'): Promise<string> {
  const email = newEmail(tag);
  await register(page, name, email);
  await login(page, email);
  await expect(page).toHaveURL(/\/pricing$/);
  return email;
}

/** pricing → select plan → checkout form filled, ready to pay */
export async function toCheckout(page: Page, planId = 'pro_monthly'): Promise<void> {
  await page.goto('/pricing');
  await page.getByTestId(`select-${planId}`).click();
  await expect(page).toHaveURL(new RegExp(`/checkout\\?plan=${planId}$`));
  await page.getByTestId('co-phone').fill('9876543210');
  await expect(page.getByTestId('summary-plan')).not.toBeEmpty();
}

export async function payAndChoose(page: Page, outcome: 'success' | 'fail' | 'cancel'): Promise<string> {
  await page.getByTestId('pay-button').click();
  await expect(page.getByTestId('mock-txnid')).toBeVisible();
  await page.getByTestId(`mock-pay-${outcome}`).click();
  await page.waitForURL(/\/payment\/result\?order=/);
  return new URL(page.url()).searchParams.get('order')!;
}

export async function backendOrder(page: Page | BrowserContext, orderId: string): Promise<{ status: number; body: any }> {
  const r = await page.request.get(`/api/payments/${orderId}`);
  return { status: r.status(), body: await r.json() };
}
export async function backendSubscription(page: Page | BrowserContext): Promise<any> {
  return (await page.request.get('/api/subscription')).json();
}
