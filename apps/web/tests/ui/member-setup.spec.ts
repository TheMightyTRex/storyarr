import { emptyDiscoveryHome, expect, test, type Page } from "../fixtures";

type Reader = { role: string; status: string; required: boolean };

async function readerRoutes(page: Page, reader: Reader) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path === "/api/auth/me")
      data = {
        user: {
          id: "reader",
          username: "reader",
          display_name: "Reader",
          role: reader.role,
          permissions: [],
          onboarding_status: reader.status,
          onboarding_required: reader.required,
        },
        csrf_token: "test",
      };
    else if (path === "/api/setup/onboarding")
      data = { status: reader.status, step: 0, skipped: [] };
    else if (path === "/api/discovery/home") data = emptyDiscoveryHome();
    else if (path === "/api/metadata/account")
      data = { connected: false, enabled: false };
    else if (path === "/api/metadata/preferences")
      data = { providers: ["openlibrary"], languages: ["en"] };
    else if (path === "/api/setup/readiness")
      data = { libraries: [], sources: [], downloaders: [], destinations: [] };
    return route.fulfill({ json: data });
  });
  return errors;
}

for (const role of ["member", "viewer"]) {
  test(`${role} can browse repeatedly with optional onboarding and reopen setup`, async ({
    page,
  }) => {
    const errors = await readerRoutes(page, {
      role,
      status: "pending",
      required: false,
    });
    await page.goto("/discover");
    await expect(
      page.getByRole("heading", { name: "Discover", exact: true }),
    ).toBeAttached();
    await expect(page).toHaveURL(/\/discover$/);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Discover", exact: true }),
    ).toBeAttached();
    await page.goto("/settings#display");
    await page
      .getByRole("button", { name: "Open onboarding setup wizard" })
      .click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(
      page.getByRole("heading", { name: "Let’s set up your library" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

for (const role of ["member", "admin"]) {
  test(`${role} still enters required first-run onboarding`, async ({
    page,
  }) => {
    const errors = await readerRoutes(page, {
      role,
      status: "pending",
      required: true,
    });
    await page.goto("/discover");
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(
      page.getByRole("heading", { name: "Let’s set up your library" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("completed setup remains dismissed", async ({ page }) => {
  await readerRoutes(page, {
    role: "member",
    status: "completed",
    required: false,
  });
  await page.goto("/discover");
  await expect(
    page.getByRole("heading", { name: "Discover", exact: true }),
  ).toBeAttached();
  await expect(page).toHaveURL(/\/discover$/);
});

test("administrator saves all OIDC presets, group mappings, and onboarding policy", async ({
  page,
}, testInfo) => {
  const errors = await readerRoutes(page, {
    role: "admin",
    status: "completed",
    required: false,
  });
  let policy = { show_member_onboarding: true };
  let finishPolicySave: (() => void) | undefined;
  let policyWrites = 0;
  let oidc = {
    enabled: true,
    label: "Test ID",
    issuer: "https://identity.example/application/o/dewarr/",
    authorization_endpoint: "https://identity.example/authorize",
    token_endpoint: "https://identity.example/token",
    userinfo_endpoint: "https://identity.example/userinfo",
    jwks_uri: "https://identity.example/jwks",
    client_id: "dewarr",
    secret_set: true,
    redirect_uri: "https://books.example/api/auth/oidc/callback",
    signing_algorithm: "RS256",
    match_existing: "off",
    auto_register: true,
    default_role: "member",
    group_claim: "groups",
    group_scope: "",
    admin_group: "admins",
    member_group: "members",
    viewer_group: "viewers",
    requester_group: "",
    approver_group: "",
  };
  const defaults: string[] = [];
  let finishFirstSave: (() => void) | undefined;
  await page.route("**/api/setup/onboarding-policy", async (route) => {
    if (route.request().method() === "PUT") {
      policy = route.request().postDataJSON();
      policyWrites += 1;
      if (policyWrites === 1)
        await new Promise<void>((resolve) => {
          finishPolicySave = resolve;
        });
    }
    return route.fulfill({ json: policy });
  });
  await page.route("**/api/auth/oidc/settings", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      expect(body.client_secret).toBe("");
      expect(body.issuer).toBe(
        "https://identity.example/application/o/dewarr/",
      );
      oidc = { ...oidc, ...body };
      defaults.push(body.default_role);
      if (defaults.length === 1)
        await new Promise<void>((resolve) => {
          finishFirstSave = resolve;
        });
    }
    return route.fulfill({ json: oidc });
  });
  await page.route("**/api/auth/access", (route) =>
    route.fulfill({ json: { presets: [], permissions: [], roles: [] } }),
  );
  await page.goto("/settings#accounts");
  const show = page.getByRole("checkbox", {
    name: "Show onboarding wizard to new members and viewers",
  });
  await expect(show).toBeChecked();
  await show.uncheck();
  await page
    .getByRole("button", { name: "Save onboarding preference" })
    .click();
  await expect.poll(() => policyWrites).toBe(1);
  await show.check();
  finishPolicySave!();
  await expect(
    page.getByRole("button", { name: "Save onboarding preference" }),
  ).toBeEnabled();
  await expect(show).toBeChecked();
  await show.uncheck();
  await page
    .getByRole("button", { name: "Save onboarding preference" })
    .click();
  await expect.poll(() => policyWrites).toBe(2);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Onboarding preference saved." }),
  ).toBeVisible();
  expect(policy.show_member_onboarding).toBe(false);
  await page.getByText("Identity provider", { exact: true }).click();
  await page.getByText("Groups", { exact: true }).click();
  await page
    .getByLabel("Requester group", { exact: true })
    .fill("family-requesters");
  await page
    .getByLabel("Approver group", { exact: true })
    .fill("family-approvers");
  for (const role of ["admin", "approver", "member", "viewer", "requester"]) {
    await page
      .getByRole("combobox", { name: "Default access", exact: true })
      .selectOption(role);
    if (role === "admin")
      await expect(
        page.getByText(/Administrator default grants full control/),
      ).toBeVisible();
    await page
      .getByRole("button", { name: "Save identity provider", exact: true })
      .click();
    await expect.poll(() => defaults.at(-1)).toBe(role);
    if (role === "admin") {
      // An edit made before the response arrives must survive that older save.
      await page
        .getByRole("combobox", { name: "Default access", exact: true })
        .selectOption("approver");
      finishFirstSave!();
    }
    await expect(
      page.getByRole("button", { name: "Save identity provider", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("combobox", { name: "Default access", exact: true }),
    ).toHaveValue(role === "admin" ? "approver" : role);
  }
  await page.reload();
  await expect(show).not.toBeChecked();
  await page.getByText("Identity provider", { exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Default access", exact: true }),
  ).toHaveValue("requester");
  await page.getByText("Groups", { exact: true }).click();
  await expect(page.getByLabel("Requester group", { exact: true })).toHaveValue(
    "family-requesters",
  );
  await expect(page.getByLabel("Approver group", { exact: true })).toHaveValue(
    "family-approvers",
  );
  await expect(page.getByLabel("Issuer URL", { exact: true })).toHaveValue(
    oidc.issuer,
  );
  expect(defaults).toEqual([
    "admin",
    "approver",
    "member",
    "viewer",
    "requester",
  ]);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("member-setup-settings.png"),
    fullPage: true,
  });
});
