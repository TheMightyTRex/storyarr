import { expect, test } from "./fixtures";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("Send feedback opens under Storyarr's own content security policy", async ({
  page,
}) => {
  test.setTimeout(60_000);
  execFileSync("uv", ["run", "python", "scripts/e2e_auth_budget.py"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    stdio: "pipe",
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("reader");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser test password");
  if (await page.getByLabel("Your name").isVisible()) {
    await page.getByLabel("Your name").fill("Test Reader");
    await page.getByRole("button", { name: "Create administrator" }).click();
    await page
      .getByRole("button", { name: "Finish later", exact: true })
      .click();
  } else {
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page.evaluate(() => {
    const blocked: string[] = [];
    (window as unknown as { blocked: string[] }).blocked = blocked;
    document.addEventListener("securitypolicyviolation", (event) =>
      blocked.push(`${event.violatedDirective} ${event.blockedURI}`),
    );
  });
  await page.getByRole("button", { name: "Send feedback" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await expect(dialog).toBeVisible();
  // Snaglist's own styles apply: the window is laid out, not plain text.
  expect(await dialog.evaluate((node) => getComputedStyle(node).display)).toBe(
    "flex",
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { blocked: string[] }).blocked,
    ),
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});
