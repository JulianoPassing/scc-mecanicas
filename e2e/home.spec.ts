import { expect, test } from "@playwright/test";

test("home mostra oficinas e login", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /SCC/i })).toBeVisible();
  await page.getByRole("button", { name: /Entrar ou cadastrar/i }).click();
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await expect(page.getByRole("textbox").first()).toBeVisible();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Criar conta" })).toBeVisible();
});

test("home no mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Mecânicas/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Entrar ou cadastrar/i })).toBeVisible();
});

test("rota protegida redireciona", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/$/);
});
