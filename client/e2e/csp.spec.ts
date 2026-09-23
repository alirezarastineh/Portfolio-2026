import { expect, inlineScripts, policyNonce, test } from "./fixtures";

const PAGES = [
  "/en",
  "/de",
  "/en/work/project-one",
  "/en/writing",
  "/de/writing/shipping-rag-to-production",
  "/en/legal/privacy",
  "/de/does-not-exist",
  "/admin/login",
];

test.describe("content security policy", () => {
  test("pages get an enforced policy with a fresh nonce per request", async ({ request }) => {
    const first = (await request.get("/en")).headers()["content-security-policy"];
    const second = (await request.get("/en")).headers()["content-security-policy"];

    expect(first).toContain("frame-ancestors 'none'");
    const scriptSrc = first?.split("; ").find((directive) => directive.startsWith("script-src "));
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(policyNonce(first)).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(policyNonce(second)).not.toBe(policyNonce(first));
  });

  test("every inline script carries the request's nonce", async ({ request }) => {
    const res = await request.get("/en");
    const nonce = policyNonce(res.headers()["content-security-policy"]);
    const scripts = inlineScripts(await res.text());

    // Analog's event-dispatch contract and Angular's replay call, at least.
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    for (const script of scripts) expect(script.nonce, script.attrs).toBe(nonce);
  });

  test("files and the BFF carry no page policy", async ({ request }) => {
    for (const path of ["/robots.txt", "/sitemap.xml", "/en/rss.xml", "/api/v1/content/en"]) {
      expect((await request.get(path)).headers()["content-security-policy"], path).toBeUndefined();
    }
  });

  for (const path of PAGES) {
    test(`${path} runs with no violations`, async ({ page, problems }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(problems.cspViolations).toEqual([]);
    });
  }
});
