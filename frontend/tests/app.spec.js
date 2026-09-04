import { expect, test } from "@playwright/test";

test("renders the application and reaches the backend mission API", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /AI-Powered UAV Damage Detection/i })).toBeVisible();

  const missionsResponse = await page.evaluate(async () => {
    const response = await fetch("http://127.0.0.1:8000/api/missions");
    return { status: response.status, success: (await response.json()).success };
  });

  expect(missionsResponse).toEqual({ status: 200, success: true });
});

test("opens the mission flow and validates required mission name", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start New Mission" }).first().click({ force: true });
  await expect(page.getByRole("heading", { name: "Create New Mission" })).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("Mission name is required");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Next: Video Upload" }).click({ force: true });
  await expect(page.getByRole("heading", { name: "Mission Setup" })).toBeVisible();
});