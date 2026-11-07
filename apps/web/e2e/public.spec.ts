import { expect, test } from '@playwright/test';
import { publishedEvent, watchErrors } from './helpers';

/** Public portal: browse, register as a guest, look the registration up, verify a certificate. */
test.describe('public portal', () => {
  const title = `อบรม Playwright ${Date.now().toString(36)}`;
  let event: { id: string; code: string };

  test.beforeAll(async () => {
    event = await publishedEvent(title);
  });

  test('home page and event list render without errors @mobile', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await expect(page.getByRole('link', { name: /SRU Event Hub/ }).first()).toBeVisible();
    await page.goto('/events?tab=open');
    await expect(page.getByText(title)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a guest registers and then finds the registration on the status page', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`/events/${event.code}`);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();

    await page.getByLabel('ประเภทผู้เข้าร่วม').click();
    await page.getByTitle('บุคคลภายนอก').click();
    await page.getByLabel('ชื่อ', { exact: true }).fill('ทดสอบ');
    await page.getByLabel('นามสกุล').fill('เบราว์เซอร์');
    await page.getByLabel('อีเมล').fill(`pw-${Date.now()}@example.com`);
    await page.getByLabel('หน่วยงาน / คณะ / สถานศึกษา').fill('โรงเรียนเพลย์ไรต์');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'ยืนยันการลงทะเบียน' }).click();

    await expect(page.getByText('ลงทะเบียนสำเร็จ')).toBeVisible();
    const ref = (await page.locator('.ant-result-subtitle strong').first().innerText()).trim();
    expect(ref).toMatch(/^REG-\d{4}-\d{6}$/);

    await page.getByRole('link', { name: 'ดูสถานะการลงทะเบียน' }).click();
    await expect(page).toHaveURL(/\/registration\/status#ref=/);
    await expect(page.getByText('ผลการตรวจสอบ')).toBeVisible();
    await expect(page.getByText(ref).first()).toBeVisible();
    await expect(page.getByText(title).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('certificate verification tells an unknown code apart @mobile', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/verify');
    await page.getByPlaceholder('เช่น AB12-CD34-EF56').fill('zzzz-zzzz-zzzz');
    await page.getByRole('button', { name: 'ตรวจสอบ' }).click();
    await expect(page).toHaveURL(/\/verify\/ZZZZ-ZZZZ-ZZZZ$/);
    await expect(page.getByText('ไม่พบเกียรติบัตรตามรหัสนี้')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
