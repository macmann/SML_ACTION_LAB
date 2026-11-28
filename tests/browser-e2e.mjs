import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const [root, phase] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.SLM_CHROMIUM });
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 780 }, colorScheme: "dark" });
  const button = (name) => page.getByRole("button", { name, exact: true });
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const screenshot = async (file) => {
    if (process.env.SLM_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SLM_SCREENSHOT_DIR, file) });
  };
  page.setDefaultTimeout(15_000);
  if (phase === "unclaimed") {
    await page.goto(root + "/assistant");
    await page.waitForURL("**/setup");
    await page.getByLabel("Pairing token").waitFor();
    assert.ok(await fits());
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    await screenshot("setup.png");
    console.log("Chromium verified the unclaimed setup redirect and form.");
  } else {
    let password = "";
    for await (const chunk of process.stdin) password += chunk;
    assert.ok(password.length >= 12);
    await page.goto(root + "/login");
    await page.getByLabel("Admin password").fill(password);
    await button("Sign in").click();
    await page.waitForURL("**/assistant");
    await page.getByText(/Local transcription is unavailable/).waitFor();
    assert.ok(await fits());
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    const settingsNav = page.getByRole("navigation", { name: "Settings sections" });
    assert.equal(await settingsNav.getByRole("link", { name: "Database Required" }).getAttribute("aria-current"), "page");
    await settingsNav.getByRole("link", { name: "Model providers Optional" }).click();
    await page.getByRole("heading", { name: "Model provider setup" }).waitFor();
    assert.equal(await page.getByLabel("Database URL").count(), 0);
    const distil = page.getByRole("heading", { name: "Distil", exact: true }).locator("..");
    await distil.getByLabel("Validation mode").selectOption("chat");
    assert.equal(await distil.getByRole("checkbox", { name: /Allow one chat completion test/ }).isChecked(), false);
    assert.ok(await fits());
    await settingsNav.getByRole("link", { name: "Local speech Optional" }).click();
    await page.getByRole("heading", { name: "Local speech" }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Distil", exact: true }).count(), 0);
    await page.getByRole("link", { name: "Documents", exact: true }).click();
    await page.getByLabel("Title for a single file").fill("Fictional release fixture");
    const body = "Fictional record ID RC-927. The Tern Library ordered four boards.";
    await page.locator('input[type="file"]').setInputFiles({
      name: "release-fixture.txt", mimeType: "text/plain", buffer: Buffer.from(body),
    });
    await page.getByRole("heading", { name: "Fictional release fixture" }).waitFor();
    await page.getByLabel("Search terms").fill("RC-927");
    await button("Search").click();
    await page.getByText("Paragraph 1", { exact: true }).waitFor();
    await button("Preview").click();
    await page.getByRole("region", { name: "Extracted text preview" }).getByText(body).waitFor();
    assert.ok(await fits());
    const downloadStarted = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download", exact: true }).click();
    const download = await downloadStarted;
    assert.equal(await readFile(await download.path(), "utf8"), body);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "light" });
    assert.ok(await fits());
    await screenshot("documents.png");
    console.log("Chromium verified login, speech unavailable state, upload, search, preview, download and responsive layout.");
  }
} finally {
  await browser.close();
}
