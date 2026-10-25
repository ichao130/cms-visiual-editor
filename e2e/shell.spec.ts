import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Start each test from a clean locale (the toggle persists to localStorage).
  await page.addInitScript(() => localStorage.removeItem("pcms.locale"));
});

test("navigates dashboard → project → site", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "プロジェクト" })).toBeVisible();

  await page.getByRole("button", { name: /珈琲店サイト運用/ }).click();
  await expect(page.getByRole("heading", { name: "サイト一覧" })).toBeVisible();

  await page.getByRole("button", { name: /テスト珈琲店/ }).click();
  // Site overview tab: analytics tiles are visible.
  await expect(page.getByText("訪問数", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近のお問い合わせ" })).toBeVisible();
});

test("opens the contact form builder and inbox", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /珈琲店サイト運用/ }).click();
  await page.getByRole("button", { name: /テスト珈琲店/ }).click();

  await page.getByRole("button", { name: "フォーム", exact: true }).click();
  await expect(page.getByRole("button", { name: /お問い合わせ/ })).toBeVisible();
  await page.getByRole("button", { name: "受信一覧" }).click();
  await expect(page.getByText("受信件数: 3")).toBeVisible();
});

test("a modal opens from posts and closes on Escape", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /珈琲店サイト運用/ }).click();
  await page.getByRole("button", { name: /テスト珈琲店/ }).click();
  await page.getByRole("button", { name: "投稿", exact: true }).click();
  await page.getByRole("button", { name: /新規作成/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("language toggle switches the UI to English", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "EN" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByText("Account")).toBeVisible();
});
