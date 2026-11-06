import { test, expect } from '@playwright/test';
import { signUpAndLogin, newEmail, register, login } from './helpers.ts';

test.describe('E2E-SEC frontend security behaviours', () => {
  test('XSS payloads in the name field are rejected and never execute', async ({ page }) => {
    await page.addInitScript(() => { (window as any).__xss = 0; });
    await page.goto('/register'); await page.getByTestId('reg-name').fill('<img src=x onerror="window.__xss=1">'); await page.getByTestId('reg-email').fill(newEmail('x1')); await page.getByTestId('reg-password').fill('Correct-Horse-42'); await page.getByTestId('reg-submit').click();
    await expect(page.getByTestId('form-error')).toContainText('not valid'); expect(await page.evaluate(() => (window as any).__xss)).toBe(0); await expect(page.locator('img[src="x"]')).toHaveCount(0);
  });
  test('reflected XSS via query strings does not execute (result page, login next param)', async ({ page }) => {
    const dialogs: string[] = []; page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); }); await page.addInitScript(() => { (window as any).__xss = 0; });
    await signUpAndLogin(page, 'Asha Rao', 'x2');
    for (const u of ['/payment/result?order=%3Cimg%20src%3Dx%20onerror%3Dwindow.__xss%3D1%3E', '/checkout?plan=%3Cscript%3Ewindow.__xss%3D1%3C%2Fscript%3E', '/pricing?x=%22%3E%3Csvg%20onload%3Dwindow.__xss%3D1%3E']) { await page.goto(u); await page.waitForLoadState('networkidle'); expect(await page.evaluate(() => (window as any).__xss), u).toBe(0); }
    expect(dialogs).toEqual([]);
  });
  test('CSP blocks injected inline script even if markup were reflected', async ({ page }) => {
    const violations: string[] = []; page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
    await page.goto('/'); await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__pwned = 1'; document.body.append(s); });
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined(); expect(violations.length).toBeGreaterThan(0);
  });
  test('open redirect via ?next= is neutralised', async ({ page }) => {
    const email = newEmail('x4'); await register(page, 'Asha Rao', email);
    for (const next of ['//evil.example/phish', 'https://evil.example', 'javascript:alert(1)', '/\\evil.example']) { await login(page, email, undefined, next); await expect(page).toHaveURL(/127\.0\.0\.1:4173\/pricing$/); await page.context().clearCookies(); }
    await login(page, email, undefined, '/dashboard'); await expect(page).toHaveURL(/\/dashboard$/);
  });
  test('session cookie is HttpOnly (invisible to page scripts) and CSRF token is not stored in cookies', async ({ page, context }) => {
    await signUpAndLogin(page, 'Asha Rao', 'x5'); expect(await page.evaluate(() => document.cookie)).toBe('');
    const c = (await context.cookies()).find((x) => x.name === 'bc_sid')!; expect(c.httpOnly).toBe(true); expect(c.sameSite).toBe('Lax');
  });
  test('merchant salt and request secrets never reach the browser', async ({ page }) => {
    const seen: string[] = []; page.on('response', async (r) => { try { seen.push(await r.text()); } catch { /* binary */ } });
    await signUpAndLogin(page, 'Asha Rao', 'x6'); await page.goto('/checkout?plan=pro_monthly'); await page.getByTestId('co-phone').fill('9876543210'); await page.getByTestId('pay-button').click(); await expect(page.getByTestId('mock-txnid')).toBeVisible();
    const all = seen.join('\n') + (await page.content()); expect(all).not.toContain('fake-e2e-salt-not-a-real-credential');
  });
  test('inline scripts / handlers are absent from every page (CSP-clean frontend)', async ({ page }) => {
    for (const p of ['/', '/register', '/login', '/pricing']) { await page.goto(p); expect(await page.locator('script:not([src])').count(), p).toBe(0); }
  });
});
