import { expect, test } from '@playwright/test';
import { loginBrowser, watchErrors } from './helpers';

/** Back office: role-aware dashboard, reports, venues, notifications and the permission gate. */
test.describe('back office', () => {
  test('a unit admin sees tasks, this year’s KPIs and the monthly chart', async ({ page, context }) => {
    const errors = watchErrors(page);
    await loginBrowser(context, 'sci.admin');
    await page.goto('/admin');
    await expect(page.getByText('งานที่รอท่าน', { exact: true })).toBeVisible();
    await expect(page.getByText(/ภาพรวมปีงบประมาณ \d{4}/)).toBeVisible();
    await expect(page.getByRole('img', { name: 'ผู้ลงทะเบียนและผู้เข้าร่วมรายเดือน' })).toBeVisible();
    await page.screenshot({ path: 'test-results/dashboard.png', fullPage: true });
    expect(errors).toEqual([]);
  });

  test('reports: overview, per-event table and the table view of a chart', async ({ page, context }) => {
    const errors = watchErrors(page);
    await loginBrowser(context, 'executive');
    await page.goto('/admin/reports');
    await expect(page.getByText('ผู้ลงทะเบียนตามหน่วยงานผู้จัด')).toBeVisible();
    await page.screenshot({ path: 'test-results/reports-overview.png', fullPage: true });

    // Every chart has a table view.
    const trend = page.locator('.ant-card', { hasText: 'ผู้ลงทะเบียนและผู้เข้าร่วมรายเดือน' });
    await trend.getByText('ตาราง', { exact: true }).click();
    await expect(trend.locator('table')).toBeVisible();

    await page.getByRole('tab', { name: 'รายกิจกรรม' }).click();
    await expect(page.getByRole('columnheader', { name: 'ลงทะเบียน' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ส่งออก Excel' })).toBeVisible();
    await page.getByRole('tab', { name: 'การเงิน' }).click();
    await expect(page.getByText('รายการค้าง')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('venues: day schedule and booking dialog', async ({ page, context }) => {
    const errors = watchErrors(page);
    await loginBrowser(context, 'sci.manager');
    await page.goto('/admin/venues');
    await expect(page.getByText('ห้องปฏิบัติการคอมพิวเตอร์ 1')).toBeVisible();
    await page.getByRole('button', { name: 'ขอจองสถานที่' }).click();
    await expect(page.getByRole('dialog', { name: 'ขอจองสถานที่' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.screenshot({ path: 'test-results/venues.png', fullPage: true });
    expect(errors).toEqual([]);
  });

  test('notifications page and bell', async ({ page, context }) => {
    const errors = watchErrors(page);
    await loginBrowser(context, 'student');
    await page.goto('/my/notifications');
    await expect(page.getByRole('heading', { name: 'การแจ้งเตือน' })).toBeVisible();
    await expect(page.getByText('ช่องทางการแจ้งเตือน')).toBeVisible();
    await page.getByRole('button', { name: /^การแจ้งเตือน/ }).click();
    await expect(page.getByRole('link', { name: 'ดูทั้งหมด / ตั้งค่าการแจ้งเตือน' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('participants without back-office rights are kept out of /admin', async ({ page, context }) => {
    await loginBrowser(context, 'student');
    await page.goto('/admin/reports');
    await expect(page.getByText('บัญชีนี้ยังไม่มีสิทธิ์ใช้งานส่วนผู้ดูแล')).toBeVisible();
  });
});
