# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: series-logo.spec.ts >> Remove takes the logo away and focus stays in the panel
- Location: tests/ui/series-logo.spec.ts:390:1

# Error details

```
Error: expect(locator).toBeFocused() failed

Locator:  getByRole('dialog', { name: 'Series logo' }).getByText('No logo saved. The series name is shown as a wordmark.')
Expected: focused
Received: inactive
Timeout:  5000ms

Call log:
  - Expect "toBeFocused" getByRole('dialog', { name: 'Series logo' }).getByText('No logo saved. The series name is shown as a wordmark.') with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'Series logo' }).getByText('No logo saved. The series name is shown as a wordmark.')
    14 × locator resolved to <p class="muted" tabindex="-1">No logo saved. The series name is shown as a word…</p>
       - unexpected value "inactive"

```

```yaml
- paragraph: No logo saved. The series name is shown as a wordmark.
```

# Test source

```ts
  300 |     panel.getByRole("tabpanel", { name: "Find online" }),
  301 |   ).toBeVisible();
  302 |   await page.keyboard.press("End");
  303 |   await expect(
  304 |     panel.getByRole("tab", { name: "Upload your own" }),
  305 |   ).toBeFocused();
  306 |   await page.keyboard.press("Home");
  307 |   await expect(cover).toBeFocused();
  308 |   // Tab stays inside the panel.
  309 |   for (let i = 0; i < 40; i++) await page.keyboard.press("Tab");
  310 |   expect(
  311 |     await panel.evaluate((element) => element.contains(document.activeElement)),
  312 |   ).toBe(true);
  313 |   await page.keyboard.press("Escape");
  314 |   await expect(panel).toBeHidden();
  315 |   await expect(opener).toBeFocused();
  316 | });
  317 | 
  318 | test("cutting the logo out of a cover uploads a PNG", async ({ page }) => {
  319 |   const { writes } = await mockSeries(page);
  320 |   await page.goto("/series/hardcover/1042");
  321 |   const panel = await openPanel(page);
  322 |   await expect(panel.getByRole("radio", { name: /Book 1/ })).toBeChecked();
  323 |   const status = panel.locator(".logo-crop__controls [role=status]");
  324 |   await expect(status).toContainText("pixels");
  325 |   // The cover is dark with a light logo, so Invert is suggested.
  326 |   await expect(panel.getByRole("switch", { name: /Invert/ })).toBeChecked();
  327 |   const canvas = panel.getByRole("img", {
  328 |     name: "2. Draw a box around the logo",
  329 |   });
  330 |   const readout = panel.locator(".logo-crop__readout");
  331 |   const before = await readout.textContent();
  332 |   await canvas.focus();
  333 |   await page.keyboard.press("ArrowDown");
  334 |   await page.keyboard.press("Shift+ArrowRight");
  335 |   await expect(readout).not.toHaveText(before || "");
  336 |   await expect(readout).toContainText("5% from the top");
  337 |   await page.keyboard.press("ArrowUp");
  338 |   await expect(panel.locator(".logo-preview .logo-mask")).toHaveCount(2);
  339 |   await expect(panel.getByText("(cut from book 1)")).toBeVisible();
  340 |   await panel.getByRole("button", { name: "Save logo" }).click();
  341 |   await expect(panel).toBeHidden();
  342 |   const put = writes.find((write) => write.method === "PUT");
  343 |   expect(put?.path).toBe("/api/catalog/series/hardcover/1042/logo");
  344 |   const query = new URLSearchParams(put?.search);
  345 |   expect(query.get("source")).toBe("cover");
  346 |   expect(query.get("title")).toBe("the cover of The Glass Harbour, book 1");
  347 |   expect(put?.type).toBe("image/png");
  348 |   expect(put?.body?.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  349 |   await expect(
  350 |     page.getByRole("status").filter({ hasText: "Logo saved" }),
  351 |   ).toContainText("config/series-logos/hardcover-1042.png");
  352 | });
  353 | 
  354 | test("Find online shows the licence, warns about a wrong match and copies the chosen file", async ({
  355 |   page,
  356 | }) => {
  357 |   const { writes } = await mockSeries(page);
  358 |   await page.goto("/series/hardcover/1042");
  359 |   const panel = await openPanel(page);
  360 |   await panel.getByRole("tab", { name: "Find online" }).click();
  361 |   await expect(panel.getByLabel("Series name")).toHaveValue(
  362 |     "The Glass Harbour",
  363 |   );
  364 |   await panel.getByRole("button", { name: "Search", exact: true }).click();
  365 |   await expect(panel.getByText("1 possible logo found.")).toBeVisible();
  366 |   const results = panel.locator(".logo-candidate");
  367 |   await expect(results).toHaveCount(2);
  368 |   await expect(results.first()).toContainText(
  369 |     "Probably not this series: it does not mention Mara Ellison",
  370 |   );
  371 |   await expect(results.first()).toContainText("Licence: CC BY-SA 4.0");
  372 |   await expect(results.nth(1).locator(".chip")).toHaveCount(0);
  373 |   await results
  374 |     .nth(1)
  375 |     .getByRole("button", { name: "Use this logo", exact: true })
  376 |     .click();
  377 |   await expect(results.nth(1)).toHaveAttribute("aria-current", "true");
  378 |   await panel
  379 |     .getByRole("radio", { name: "Accent colour" })
  380 |     .check({ force: true });
  381 |   await panel.getByRole("button", { name: "Save logo" }).click();
  382 |   await expect(panel).toBeHidden();
  383 |   const post = writes.find((write) => write.path.endsWith("/logo/commons"));
  384 |   expect(JSON.parse(post!.body!.toString())).toEqual({
  385 |     title: "Glass Harbour wordmark.svg",
  386 |     colour: "accent",
  387 |   });
  388 | });
  389 | 
  390 | test("Remove takes the logo away and focus stays in the panel", async ({
  391 |   page,
  392 | }) => {
  393 |   const { writes } = await mockSeries(page);
  394 |   await page.goto("/series/hardcover/1042");
  395 |   const panel = await openPanel(page);
  396 |   await panel.getByRole("button", { name: "Remove logo" }).click();
  397 |   const none = panel.getByText(
  398 |     "No logo saved. The series name is shown as a wordmark.",
  399 |   );
> 400 |   await expect(none).toBeFocused();
      |                      ^ Error: expect(locator).toBeFocused() failed
  401 |   expect(writes.some((write) => write.method === "DELETE")).toBe(true);
  402 |   await panel.getByRole("button", { name: "Close series logo" }).click();
  403 |   await expect(
  404 |     page.getByRole("heading", { level: 1, name: "The Glass Harbour" }),
  405 |   ).toHaveClass(/wordmark/);
  406 | });
  407 | 
```