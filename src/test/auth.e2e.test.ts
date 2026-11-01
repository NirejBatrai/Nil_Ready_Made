// @vitest-environment node
/**
 * OPT-IN end-to-end test of the real owner-login request flow: `bun run test:e2e`.
 *
 * Isolation (fails closed if any check cannot be confirmed):
 * - The project is copied to a temporary folder from `git ls-files --cached --others
 *   --exclude-standard`, so ignored files — including the real .env — are never read or copied.
 *   Any env-like file in the list or in the copy aborts the run.
 * - The database is a throwaway mongodb-memory-server on 127.0.0.1; any other address aborts.
 * - The dev server in the copy gets a fresh environment whose only MONGODB_URI is that database.
 * - Login only succeeds for an owner that exists solely in the throwaway database, and the test
 *   checks the session lands there.
 * Requires a local Google Chrome (CHROME_PATH or /usr/bin/google-chrome); skipped without it.
 */
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createServer, connect } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import mongoose, { type Connection } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthService, ensureAuthIndexes } from "@/server/auth/auth.server";
import { connectOptions } from "@/server/db.server";
import { sessionModel } from "@/server/models/session.server";
import { ensureProductIndexes, productModel } from "@/server/models/product.server";
import { createProductService } from "@/server/products.server";
import { quickSaleModel } from "@/server/models/quick-sale.server";
import { bangkokTime } from "@/lib/bangkok-time";

const ENABLED = process.env["RUN_AUTH_E2E"] === "1";
const CHROME = process.env["CHROME_PATH"] ?? "/usr/bin/google-chrome";
const HAVE_CHROME = existsSync(CHROME);

const EMAIL = "e2e-owner@example.invalid";
const PASSWORD = "e2e-test-password-1"; // throwaway database only
const COOKIE = "luxe_session";
// INTERIM Quick Sales (decision 0004): staff accounts and a throwaway API token for this run only.
const STAFF_EMAIL = "e2e-staff@example.invalid";
const STAFF2_EMAIL = "e2e-staff2@example.invalid";
const SUMMARY_TOKEN = randomBytes(32).toString("base64");
const ENV_LIKE = /(^|\/)(\.env(\..*)?|\.dev\.vars)$/;
const LEAK =
  /"stack"|\bat\s+\S+\s*\(|\/tmp\/|\/home\/|node_modules|\.server\.ts|mongodb(\+srv)?:\/\//;

// Baseline security headers every dynamic response must carry (written out independently).
const SECURITY_HEADERS = {
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "accelerometer=(), autoplay=(), bluetooth=(), camera=(), display-capture=(), geolocation=(), " +
    "gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), serial=(), " +
    "usb=(), xr-spatial-tracking=()",
};
function expectSecured(headers: Headers, what: string) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS))
    expect(headers.get(name), `${what}: ${name}`).toBe(value);
  expect(headers.get("cache-control"), `${what}: cache-control`).toBe("no-store");
  expect(headers.get("strict-transport-security"), `${what}: no HSTS over http`).toBeNull();
}

const root = process.cwd();
let copy = "";
let server: MongoMemoryServer | undefined;
let conn: Connection | undefined;
let dev: ChildProcess | undefined;
let devOutput = "";
let browser: Browser | undefined;
let context: BrowserContext;
let page: Page;
let base = "";
let port = 0;
let productId = "";
const responses: string[] = [];
const requests: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}[] = [];

function fail(reason: string): never {
  throw new Error(`E2E isolation check failed: ${reason}. Nothing was run against it.`);
}

function makeIsolatedCopy(): string {
  const listed = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: root,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);
  for (const f of listed)
    if (ENV_LIKE.test(f) && !f.endsWith(".env.example")) fail(`env-like file listed: ${f}`);
  const dir = mkdtempSync(join(tmpdir(), "luxe-e2e-"));
  for (const f of listed) {
    if (!existsSync(join(root, f))) continue; // deleted but still tracked
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    copyFileSync(join(root, f), join(dir, f));
  }
  const present = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter(
    (f) => ENV_LIKE.test(f) && !f.endsWith(".env.example"),
  );
  if (present.length) fail("env-like file present in the copy");
  return dir;
}

function install(dir: string) {
  const args = ["install", "--frozen-lockfile"];
  const direct = spawnSync("bun", args, { cwd: dir, encoding: "utf8" });
  const r = direct.error
    ? spawnSync("npx", ["-y", "bun@1", ...args], { cwd: dir, encoding: "utf8" })
    : direct;
  if (r.status !== 0) throw new Error("bun install failed in the isolated copy");
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const address = s.address();
      s.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });

const canConnect = (host: string, p: number) =>
  new Promise<boolean>((resolve) => {
    const s = connect({ host, port: p });
    s.setTimeout(1500);
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
    s.once("timeout", () => (s.destroy(), resolve(false)));
  });

async function startDevServer(dir: string, mongoUri: string) {
  if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/luxe_e2e$/.test(mongoUri))
    fail("database URI is not the local test database");
  dev = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "dev", "--port", String(port), "--strictPort"],
    {
      cwd: dir,
      // A fresh environment: nothing inherited can point the server at another database.
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: tmpdir(),
        MONGODB_URI: mongoUri,
        SUMMARY_API_TOKEN: SUMMARY_TOKEN,
        NO_COLOR: "1",
      },
    },
  );
  // Strip terminal colour codes (ESC [ … m), in case NO_COLOR is ignored.
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  const collect = (d: Buffer) => (devOutput += d.toString().replace(ansi, ""));
  dev.stdout?.on("data", collect);
  dev.stderr?.on("data", collect);
  const started = Date.now();
  while (!/Local:/.test(devOutput)) {
    if (Date.now() - started > 120_000 || dev.exitCode !== null)
      throw new Error("dev server did not start");
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!devOutput.includes(`http://127.0.0.1:${port}/`)) fail("dev server is not on 127.0.0.1");
  if (/Network:\s+http/.test(devOutput)) fail("dev server advertises a network address");
}

/** Clicks a dev-page action and returns its output once that run has finished. */
async function act(id: string): Promise<string> {
  const out = page.getByTestId("out");
  const before = Number(await out.getAttribute("data-runs"));
  await page.getByTestId(id).click();
  await page.waitForFunction(
    (n) => Number(document.querySelector('[data-testid="out"]')?.getAttribute("data-runs")) > n,
    before,
  );
  return (await out.textContent()) ?? "";
}

async function signIn(email = EMAIL, password = PASSWORD) {
  await page.getByTestId("email").fill(email);
  await page.getByTestId("password").fill(password);
  return act("login");
}

const sessionCookie = async () => (await context.cookies()).find((c) => c.name === COOKIE);

/** Replays a captured server-function request from Node with chosen origin headers and cookie. */
async function replay(
  req: (typeof requests)[number],
  opts: {
    origin?: "same" | "cross" | "none";
    cookie?: string;
    extraHeaders?: Record<string, string>;
  },
) {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers))
    if (!/^(host|cookie|origin|referer|sec-fetch-.*|content-length)$/i.test(k)) headers[k] = v;
  if (opts.origin === "same") headers["sec-fetch-site"] = "same-origin";
  if (opts.origin === "cross") {
    headers["sec-fetch-site"] = "cross-site";
    headers["origin"] = "https://evil.example";
  }
  if (opts.cookie) headers["cookie"] = `${COOKIE}=${opts.cookie}`;
  Object.assign(headers, opts.extraHeaders);
  const res = await fetch(req.url, { method: req.method, headers, body: req.body });
  const text = await res.text();
  responses.push(text);
  return { status: res.status, text, headers: res.headers };
}

const lastRequest = (fragment: string) => {
  const found = [...requests].reverse().find((r) => r.url.includes(fragment));
  if (!found) throw new Error(`no captured request for ${fragment}`);
  return found;
};

describe.skipIf(!ENABLED || !HAVE_CHROME)(
  "owner login: real request flow (isolated)",
  { timeout: 60_000 },
  () => {
    beforeAll(async () => {
      copy = makeIsolatedCopy();
      install(copy);

      server = await MongoMemoryServer.create({ instance: { ip: "127.0.0.1" } });
      const uri = server.getUri();
      if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/$/.test(uri)) fail("test database is not on 127.0.0.1");
      conn = mongoose.createConnection();
      await conn.openUri(uri, { ...connectOptions(false), dbName: "luxe_e2e" });
      await ensureAuthIndexes(conn);
      await ensureProductIndexes(conn);
      const owner = await createAuthService(conn).createFirstOwner({
        email: EMAIL,
        name: "E2E Owner",
        password: PASSWORD,
      });
      if (!owner.ok) throw new Error(owner.error);
      for (const [email, name] of [
        [STAFF_EMAIL, "E2E Staff"],
        [STAFF2_EMAIL, "E2E Staff Two"],
      ] as const) {
        const staff = await createAuthService(conn).createStaff({
          email,
          name,
          password: PASSWORD,
        });
        if (!staff.ok) throw new Error(staff.error);
      }
      const product = await createProductService(conn).createProduct({
        name: "E2E Towel",
        sku: "LX-E2E-1",
        category: "accessories",
        priceSatang: 50000,
        minimumSellingPriceSatang: 35000,
        costSatang: 20000,
        lowStockThreshold: 1,
        variants: [{ sku: "LX-E2E-1" }],
      });
      if (!product.ok) throw new Error(product.error);
      productId = product.data.id;

      port = await freePort();
      base = `http://127.0.0.1:${port}`;
      await startDevServer(copy, `${uri}luxe_e2e`);

      browser = await chromium.launch({ executablePath: CHROME, headless: true });
      context = await browser.newContext();
      page = await context.newPage();
      page.on("request", (r) => {
        if (r.url().includes("/_serverFn"))
          requests.push({
            url: r.url(),
            method: r.method(),
            headers: r.headers(),
            body: r.postData(),
          });
      });
      page.on("response", async (r) => {
        if (r.url().includes("/_serverFn")) responses.push(await r.text().catch(() => ""));
      });
      await page.goto(`${base}/dev/auth`, { waitUntil: "networkidle" });
      await page.getByTestId("product-id").fill(productId);
    }, 600_000);

    afterAll(async () => {
      await browser?.close().catch(() => undefined);
      dev?.kill("SIGTERM");
      await conn?.destroy().catch(() => undefined);
      await server?.stop().catch(() => undefined);
      if (copy) rmSync(copy, { recursive: true, force: true });
    }, 60_000);

    it("the dev server listens only on 127.0.0.1", async () => {
      expect(await canConnect("127.0.0.1", port)).toBe(true);
      expect(await canConnect("::1", port)).toBe(false);
      const lan = Object.values(networkInterfaces())
        .flat()
        .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
      if (lan) expect(await canConnect(lan, port)).toBe(false);
    });

    it("pages, 404s and server functions carry the security headers; static files keep their caching", async () => {
      for (const path of ["/", "/login", "/dev/auth", "/does-not-exist"]) {
        const res = await fetch(`${base}${path}`, { redirect: "manual" });
        await res.text();
        expectSecured(res.headers, path);
      }
      const missing = await fetch(`${base}/does-not-exist`);
      await missing.text();
      expect(missing.status).toBe(404);
      // Static files are served by Vite before the app, so dynamic no-store never reaches them. No
      // security header at all proves this response did not pass through src/server.ts (in dev
      // nothing adds them to static files; the production Node server adds the baseline through
      // the nitro.config.ts route rule, checked in the production-build test below).
      const favicon = await fetch(`${base}/favicon.ico`);
      expect((await favicon.arrayBuffer()).byteLength).toBeGreaterThan(0);
      expect(favicon.status).toBe(200);
      for (const name of Object.keys(SECURITY_HEADERS))
        expect(favicon.headers.get(name), `favicon: ${name}`).toBeNull();
      expect(favicon.headers.get("cache-control")).not.toBe("no-store");
    });

    it("before login: no user, owner-only data refused", async () => {
      expect(await act("whoami")).toBe("null");
      expect(await act("owner-product")).toBe("error: Not signed in.");
    });

    it("wrong password: generic error and no cookie", async () => {
      expect(await signIn(EMAIL, "wrong-password-1")).toBe(
        JSON.stringify({ ok: false, error: "Email or password is incorrect." }),
      );
      expect(await sessionCookie()).toBeUndefined();
    });

    it("login sets an HttpOnly, SameSite=Lax, 7-day session cookie stored only as a hash", async () => {
      const out = await signIn();
      expect(JSON.parse(out)).toEqual({ ok: true, user: { name: "E2E Owner", role: "owner" } });
      const cookie = await sessionCookie();
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", secure: false });
      const days = ((cookie?.expires ?? 0) * 1000 - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThanOrEqual(7);
      expect(await page.evaluate(() => document.cookie)).not.toContain(COOKIE);
      // The session was written to the throwaway database (proves the server used it).
      if (!conn) throw new Error("no test db");
      expect(await sessionModel(conn).countDocuments()).toBe(1);
    });

    it("signed in: who-am-I returns name and role only; owner data includes cost", async () => {
      expect(JSON.parse(await act("whoami"))).toEqual({ name: "E2E Owner", role: "owner" });
      expect(JSON.parse(await act("owner-product"))).toMatchObject({
        id: productId,
        costSatang: 20000,
      });
      await page.getByTestId("product-id").fill("not-an-id");
      expect(await act("owner-product")).toBe("null");
      await page.getByTestId("product-id").fill(productId);
    });

    it("CSRF: cross-site or origin-less requests are rejected; same-origin works", async () => {
      const token = (await sessionCookie())?.value ?? "";
      await act("owner-product");
      const req = lastRequest("/_serverFn");
      const cross = await replay(req, { origin: "cross", cookie: token });
      expect(cross.status).toBe(403);
      expectSecured(cross.headers, "CSRF 403");
      expect((await replay(req, { origin: "none", cookie: token })).status).toBe(403);
      const same = await replay(req, { origin: "same", cookie: token });
      expect(same.status).toBe(200);
      expectSecured(same.headers, "owner server function");
      expect(same.text).toContain('"costSatang"'); // owner data, delivered only to the same-origin request
      // Login itself is also protected against cross-site posts.
      await signIn(EMAIL, "wrong-password-1");
      const loginReq = requests.filter((r) => r.method === "POST").at(-1);
      if (!loginReq) throw new Error("no login request captured");
      expect((await replay(loginReq, { origin: "cross" })).status).toBe(403);
    });

    it("logout clears the cookie and revokes the session on the server", async () => {
      const token = (await sessionCookie())?.value ?? "";
      await act("owner-product");
      const req = lastRequest("/_serverFn");
      expect(JSON.parse(await act("logout"))).toEqual({ ok: true });
      expect(await sessionCookie()).toBeUndefined();
      const replayed = await replay(req, { origin: "same", cookie: token });
      expect(replayed.text).toContain("Not signed in.");
      expect(replayed.text).not.toContain('"cost');
      expect(await act("owner-product")).toBe("error: Not signed in.");
    });

    it("an expired session is refused and its cookie cleared", async () => {
      expect(JSON.parse(await signIn())).toMatchObject({ ok: true });
      if (!conn) throw new Error("no test db");
      await sessionModel(conn).updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      expect(await act("owner-product")).toBe("error: Not signed in.");
      expect(await act("whoami")).toBe("null");
      expect(await sessionCookie()).toBeUndefined();
    });

    // ---- /login page (the real owner sign-in UI) ----
    let loginPage: Page;
    const openLogin = async () => {
      loginPage ??= await context.newPage();
      loginPage.on("request", (r) => {
        if (r.url().includes("/_serverFn"))
          requests.push({
            url: r.url(),
            method: r.method(),
            headers: r.headers(),
            body: r.postData(),
          });
      });
      loginPage.on("response", async (r) => {
        if (r.url().includes("/_serverFn")) responses.push(await r.text().catch(() => ""));
      });
      await loginPage.goto(`${base}/login`, { waitUntil: "networkidle" });
    };
    const html = async (path: string, cookie?: string) => {
      const res = await fetch(`${base}${path}`, {
        headers: cookie ? { cookie: `${COOKIE}=${cookie}` } : {},
      });
      return res.text();
    };
    const submitLogin = async (email: string, password: string) => {
      await loginPage.waitForSelector('[data-testid="login-submit"]:not([disabled])');
      await loginPage.getByTestId("login-email").fill(email);
      await loginPage.getByTestId("login-password").fill(password);
      await loginPage.getByTestId("login-submit").click();
    };

    it("/login server HTML: POST form, button disabled until hydrated, no sensitive data", async () => {
      const page0 = await html("/login");
      expect(page0).toMatch(
        /<form[^>]*method="post"[^>]*data-testid="login-form"|<form[^>]*data-testid="login-form"[^>]*method="post"/,
      );
      // The HTML attribute, not the word: the Button's Tailwind classes contain "disabled:".
      expect(page0.match(/<button[^>]*data-testid="login-submit"[^>]*>/)?.[0]).toMatch(
        /\sdisabled=""/,
      );
      for (const secret of ['"cost', productId, "E2E Towel", EMAIL, PASSWORD, COOKIE])
        expect(page0).not.toContain(secret);
    });

    it("/login wrong password: generic error, password cleared, no cookie", async () => {
      await openLogin();
      await submitLogin(EMAIL, "wrong-password-9");
      await expect
        .poll(() => loginPage.getByTestId("login-error").textContent())
        .toBe("Email or password is incorrect.");
      expect(await loginPage.getByTestId("login-password").inputValue()).toBe("");
      expect(await sessionCookie()).toBeUndefined();
    });

    it("/login success: shows the owner's name and Log out; state survives a reload; storage stays clean", async () => {
      await submitLogin(EMAIL, PASSWORD);
      await loginPage.waitForSelector('[data-testid="signed-in"]');
      expect(await loginPage.getByTestId("signed-in-name").textContent()).toBe("E2E Owner");
      expect(await loginPage.getByTestId("logout-button").isVisible()).toBe(true);
      const cookie = await sessionCookie();
      expect(cookie?.httpOnly).toBe(true);
      const token = cookie?.value ?? "";
      // Server-rendered from the cookie alone: no client-side state involved.
      const reloaded = await html("/login", token);
      expect(reloaded).toContain('data-testid="signed-in"');
      expect(reloaded).toContain("E2E Owner");
      // Nothing secret in browser storage, the URL, or any request URL.
      const storage = await loginPage.evaluate(() =>
        JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
      );
      for (const secret of [PASSWORD, token]) expect(storage).not.toContain(secret);
      expect(loginPage.url()).toBe(`${base}/login`);
      for (const r of requests) expect(r.url).not.toContain(PASSWORD);
    });

    it("/login logout: form returns, cookie cleared, the old session no longer works", async () => {
      const token = (await sessionCookie())?.value ?? "";
      await loginPage.getByTestId("logout-button").click();
      await loginPage.waitForSelector('[data-testid="login-form"]');
      expect(await sessionCookie()).toBeUndefined();
      const after = await html("/login", token);
      expect(after).toContain('data-testid="login-form"');
      expect(after).not.toContain("E2E Owner");
    });

    // ---- /owner/products (real data, owner-only, read-only) ----
    describe("/owner/products", () => {
      const SECOND = "E2E Sun Hat";
      const ARCHIVED = "E2E Archived Bag";
      const SECRET_COST = 432_109; // satang (฿4,321.09); distinctive, so any leak is detectable

      beforeAll(async () => {
        if (!conn) throw new Error("no test db");
        const products = createProductService(conn);
        const hat = await products.createProduct({
          name: SECOND,
          sku: "LX-E2E-2",
          category: "accessories",
          priceSatang: 79000,
          minimumSellingPriceSatang: 59000,
          costSatang: SECRET_COST,
          lowStockThreshold: 1,
          variants: [{ sku: "LX-E2E-2" }],
        });
        const bag = await products.createProduct({
          name: ARCHIVED,
          sku: "LX-E2E-3",
          category: "bags",
          priceSatang: 99000,
          minimumSellingPriceSatang: 89000,
          costSatang: SECRET_COST,
          lowStockThreshold: 1,
          variants: [{ sku: "LX-E2E-3" }],
        });
        if (!hat.ok || !bag.ok) throw new Error("test product setup failed");
        if (!(await products.setProductActive(bag.data.id, false)).ok)
          throw new Error("archive failed");
      });

      const rowNames = () =>
        loginPage.locator('[data-testid="product-row"] td:first-child').allTextContents();
      const logoutViaLoginPage = async () => {
        await loginPage.goto(`${base}/login`, { waitUntil: "networkidle" });
        await loginPage.getByTestId("logout-button").click();
        await loginPage.waitForSelector('[data-testid="login-form"]');
      };

      it("signed out: the server and the browser both redirect to /login?redirect=/owner/products", async () => {
        const res = await fetch(`${base}/owner/products`, { redirect: "manual" });
        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(400);
        expect(res.headers.get("location")).toMatch(/\/login\?redirect=%2Fowner%2Fproducts$/);
        expectSecured(res.headers, "/owner/products redirect");
        await loginPage.goto(`${base}/owner/products`);
        await loginPage.waitForURL(`${base}/login?redirect=%2Fowner%2Fproducts`);
      });

      it("the demo's simulated Owner role grants nothing here", async () => {
        const demo = await context.newPage();
        await demo.goto(`${base}/`, { waitUntil: "networkidle" });
        await demo.getByRole("button", { name: /^Owner/ }).click();
        await demo.waitForURL(`${base}/dashboard`);
        await demo.goto(`${base}/owner/products`);
        await demo.waitForURL(`${base}/login?redirect=%2Fowner%2Fproducts`);
        expect(await sessionCookie()).toBeUndefined();
        await demo.close();
      });

      it("the redirect is allowlisted: any other target is ignored after sign-in", async () => {
        for (const target of ["https://evil.example/x", "//evil.example", "/dashboard"]) {
          await loginPage.goto(`${base}/login?redirect=${encodeURIComponent(target)}`, {
            waitUntil: "networkidle",
          });
          await submitLogin(EMAIL, PASSWORD);
          await loginPage.waitForSelector('[data-testid="signed-in"]');
          const url = new URL(loginPage.url());
          expect(url.origin).toBe(base);
          expect(url.pathname).toBe("/login");
          expect(await loginPage.getByTestId("manage-products-link").getAttribute("href")).toBe(
            "/owner/products",
          );
          await logoutViaLoginPage();
        }
      });

      it("after sign-in it returns to /owner/products: active products only, no cost anywhere", async () => {
        await loginPage.goto(`${base}/owner/products`);
        await loginPage.waitForURL(`${base}/login?redirect=%2Fowner%2Fproducts`);
        await submitLogin(EMAIL, PASSWORD);
        await loginPage.waitForURL(`${base}/owner/products`);
        await loginPage.waitForSelector('[data-testid="products-table"]');
        expect((await rowNames()).sort()).toEqual(["E2E Sun Hat", "E2E Towel"]);
        const towel = loginPage.locator('[data-testid="product-row"]', { hasText: "E2E Towel" });
        // Columns: name, SKU, category, price, minimum, stock, status. New products start at 0.
        expect((await towel.locator("td").allTextContents()).slice(3, 6)).toEqual([
          "฿500.00",
          "฿350.00",
          "0",
        ]);
        const content = await loginPage.content();
        for (const leak of ['"cost', String(SECRET_COST), "฿200.00", ARCHIVED])
          expect(content).not.toContain(leak);
        const token = (await sessionCookie())?.value ?? "";
        const ssr = await html("/owner/products", token);
        expect(ssr).toContain("E2E Sun Hat");
        const owned = await fetch(`${base}/owner/products`, {
          headers: { cookie: `${COOKIE}=${token}` },
          redirect: "manual",
        });
        await owned.text();
        expect(owned.status).toBe(200);
        expectSecured(owned.headers, "signed-in /owner/products");
        for (const leak of ['"cost', String(SECRET_COST), ARCHIVED])
          expect(ssr).not.toContain(leak);
      });

      it("the list server function checks the real session on every call", async () => {
        await loginPage.getByRole("link", { name: "Account" }).click();
        await loginPage.waitForSelector('[data-testid="signed-in"]');
        await loginPage.getByTestId("manage-products-link").click(); // client-side: RPC from the browser
        await loginPage.waitForSelector('[data-testid="products-table"]');
        const req = lastRequest("/_serverFn");
        const token = (await sessionCookie())?.value ?? "";
        const owner = await replay(req, { origin: "same", cookie: token });
        expect(owner.text).toContain(SECOND);
        expectSecured(owner.headers, "listProductsForOwner");
        expect(owner.text).not.toContain('"cost');
        const anonymous = await replay(req, { origin: "same" });
        expect(anonymous.text).toContain("Not signed in.");
        expect(anonymous.text).not.toContain(SECOND);
        const forged = await replay(req, { origin: "same", cookie: "A".repeat(43) });
        expect(forged.text).toContain("Not signed in.");
        expect((await replay(req, { origin: "cross", cookie: token })).status).toBe(403);
      });

      it("shows a loading state while the request is slow", async () => {
        await loginPage.route("**/_serverFn/**", async (route) => {
          await new Promise((r) => setTimeout(r, 1500));
          // The request may have been aborted by navigation meanwhile; that is fine.
          await route.continue().catch(() => undefined);
        });
        await loginPage.getByRole("link", { name: "Account" }).click();
        await loginPage.waitForSelector('[data-testid="signed-in"]');
        await loginPage.getByTestId("manage-products-link").click();
        await loginPage.getByTestId("products-loading").waitFor();
        await loginPage.waitForSelector('[data-testid="products-table"]');
        await loginPage.unrouteAll({ behavior: "ignoreErrors" });
      });

      it("shows an empty state when there are no products (test DB cleared)", async () => {
        if (!conn) throw new Error("no test db");
        await productModel(conn).collection.deleteMany({});
        await loginPage.reload({ waitUntil: "networkidle" });
        expect(await loginPage.getByTestId("products-empty").textContent()).toMatch(
          /No products in the database yet/,
        );
        await logoutViaLoginPage();
        expect(await sessionCookie()).toBeUndefined();
      });
    });

    // ---- /owner/products/new (real-owner-only product creation) ----
    describe("/owner/products/new", () => {
      const SECRET_COST = "7,777.77"; // typed; stored as 777777 satang; distinctive for leak checks
      const SECRET_COST_SATANG = 777_777;
      let createRequest: (typeof requests)[number] | undefined;

      const goToForm = async () => {
        await loginPage.goto(`${base}/owner/products/new`, { waitUntil: "networkidle" });
        await loginPage.waitForSelector('[data-testid="np-submit"]:not([disabled])');
      };
      const fillBasics = async (f: {
        name: string;
        sku: string;
        price: string;
        minimum: string;
      }) => {
        await loginPage.getByTestId("np-name").fill(f.name);
        await loginPage.getByTestId("np-sku").fill(f.sku);
        await loginPage.getByTestId("np-price").fill(f.price);
        await loginPage.getByTestId("np-minimum").fill(f.minimum);
      };
      const variant = (i: number, field: "SKU" | "size" | "colour" | "barcode") =>
        loginPage.getByLabel(`Variant ${i} ${field}`);
      const submitAndReadError = async () => {
        await loginPage.getByTestId("np-submit").click();
        await loginPage.getByTestId("np-error").waitFor();
        return loginPage.getByTestId("np-error").textContent();
      };
      const count = (filter: Record<string, unknown> = {}) => {
        if (!conn) throw new Error("no test db");
        return productModel(conn).countDocuments(filter);
      };

      it("signed out, or with only the demo's simulated Owner role: redirected to sign-in", async () => {
        const res = await fetch(`${base}/owner/products/new`, { redirect: "manual" });
        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(400);
        expect(res.headers.get("location")).toMatch(/\/login\?redirect=%2Fowner%2Fproducts$/);
        expectSecured(res.headers, "/owner/products/new redirect");
        const demo = await context.newPage();
        await demo.goto(`${base}/`, { waitUntil: "networkidle" });
        await demo.getByRole("button", { name: /^Owner/ }).click();
        await demo.waitForURL(`${base}/dashboard`);
        await demo.goto(`${base}/owner/products/new`);
        await demo.waitForURL(`${base}/login?redirect=%2Fowner%2Fproducts`);
        await demo.close();
        expect(await sessionCookie()).toBeUndefined();
      });

      it("server HTML for the owner: POST form, submit disabled until hydrated, no cost", async () => {
        await loginPage.goto(`${base}/login?redirect=%2Fowner%2Fproducts`, {
          waitUntil: "networkidle",
        });
        await submitLogin(EMAIL, PASSWORD);
        await loginPage.waitForURL(`${base}/owner/products`);
        const page0 = await html("/owner/products/new", (await sessionCookie())?.value);
        expect(page0).toMatch(/<form[^>]*method="post"/);
        expect(page0.match(/<button[^>]*data-testid="np-submit"[^>]*>/)?.[0]).toMatch(
          /\sdisabled=""/,
        );
        expect(page0).not.toContain('"cost');
      });

      it("creates a multi-variant product: normalized SKUs/barcode, stock 0, cost stored but never returned", async () => {
        await loginPage.goto(`${base}/owner/products`, { waitUntil: "networkidle" });
        // The list starts empty, so the router has an empty list cached once we leave the page.
        await loginPage.getByTestId("products-empty").waitFor();
        // Records whether the empty list is ever rendered after submitting, however briefly
        // (the stale list used to show for ~10–40 ms, too short for a one-off check).
        await loginPage.evaluate(() => {
          const w = window as Window & { __staleList?: { armed: boolean; shown: boolean } };
          const state = { armed: false, shown: false };
          w.__staleList = state;
          new MutationObserver(() => {
            if (state.armed && document.querySelector('[data-testid="products-empty"]'))
              state.shown = true;
          }).observe(document.body, { subtree: true, childList: true });
        });
        await loginPage.getByTestId("add-product-link").click();
        await loginPage.waitForSelector('[data-testid="np-submit"]:not([disabled])');
        const firstResponse = responses.length;
        await fillBasics({
          name: "E2E Linen Shirt",
          sku: " lx-e2e-new ",
          price: "1,200.50",
          minimum: "900.25",
        });
        await loginPage.getByTestId("np-category").selectOption("dresses");
        await loginPage.getByTestId("np-cost").fill(SECRET_COST);
        await loginPage.getByTestId("np-threshold").fill("2");
        await variant(1, "SKU").fill("lx-e2e-new-s");
        await variant(1, "size").fill("S");
        await variant(1, "barcode").fill("  abc12345 ");
        await loginPage.getByTestId("np-add-variant").click();
        await variant(2, "SKU").fill("lx-e2e-new-m");
        await variant(2, "size").fill("M");
        await loginPage.evaluate(() => {
          const w = window as Window & { __staleList?: { armed: boolean; shown: boolean } };
          if (w.__staleList) w.__staleList.armed = true;
        });
        await loginPage.getByTestId("np-submit").click();
        await loginPage.waitForURL(`${base}/owner/products`);
        const row = loginPage.locator('[data-testid="product-row"]', {
          hasText: "E2E Linen Shirt",
        });
        await row.waitFor({ timeout: 5000 });
        // The list must load fresh: the earlier (now stale, empty) list may never be shown.
        expect(
          await loginPage.evaluate(() => {
            const w = window as Window & { __staleList?: { armed: boolean; shown: boolean } };
            return w.__staleList;
          }),
        ).toEqual({ armed: true, shown: false });
        expect((await row.locator("td").allTextContents()).slice(1, 6)).toEqual([
          "LX-E2E-NEW",
          "Dresses",
          "฿1,200.50",
          "฿900.25",
          "0",
        ]);
        if (!conn) throw new Error("no test db");
        const stored = await productModel(conn)
          .findOne({ sku: "LX-E2E-NEW" })
          .select("+costSatang")
          .lean();
        // Integer satang, exact: no floating-point drift from the decimals typed.
        expect(stored).toMatchObject({
          priceSatang: 120_050,
          minimumSellingPriceSatang: 90_025,
          costSatang: SECRET_COST_SATANG,
        });
        expect(stored && "price" in stored).toBe(false);
        expect(stored?.variants.map((v) => [v.sku, v.barcode, v.openingStock, v.stock])).toEqual([
          ["LX-E2E-NEW-S", "ABC12345", 0, 0],
          ["LX-E2E-NEW-M", undefined, 0, 0],
        ]);
        // Nothing the browser received since submitting contains the cost.
        for (const body of responses.slice(firstResponse)) {
          for (const leak of [SECRET_COST, "7777.77", String(SECRET_COST_SATANG), '"cost'])
            expect(body).not.toContain(leak);
        }
        expect(await loginPage.content()).not.toContain(String(SECRET_COST_SATANG));
        expect(await loginPage.content()).not.toContain("7,777.77");
      });

      it("invalid input shows the right message and saves nothing", async () => {
        const before = await count();
        await goToForm();
        await fillBasics({ name: "Bad", sku: "LX-E2E-BAD", price: "500", minimum: "600" });
        expect(await submitAndReadError()).toBe(
          "Minimum selling price cannot be higher than the selling price.",
        );
        // Checked in the browser before anything is sent (the server checks satang again).
        const sentBefore = requests.length;
        await fillBasics({ name: "Bad", sku: "LX-E2E-BAD", price: "12.505", minimum: "0" });
        expect(await submitAndReadError()).toBe(
          "Selling price: Use at most 2 decimal places (satang).",
        );
        await fillBasics({ name: "Bad", sku: "LX-E2E-BAD", price: "500", minimum: "-1" });
        expect(await submitAndReadError()).toBe("Minimum price: The amount cannot be negative.");
        await fillBasics({ name: "Bad", sku: "LX-E2E-BAD", price: "10,000,000.01", minimum: "0" });
        expect(await submitAndReadError()).toBe(
          "Selling price: The amount is too large (maximum ฿10,000,000.00).",
        );
        await fillBasics({ name: "Bad", sku: "LX-E2E-BAD", price: "1.800,50", minimum: "0" });
        expect(await submitAndReadError()).toBe(
          "Selling price: Enter an amount like 1800, 1,800 or 1800.50.",
        );
        expect(requests.length).toBe(sentBefore);
        await fillBasics({ name: "Bad", sku: "LX-E2E-BAD", price: "500", minimum: "300" });
        await variant(1, "barcode").fill("88-50");
        expect(await submitAndReadError()).toMatch(/Barcode must be 4–64 letters or digits/);
        expect(await count()).toBe(before);
      });

      it("a duplicate SKU in different letter case gets the duplicate message", async () => {
        const before = await count();
        await goToForm();
        await fillBasics({ name: "Dup", sku: "LX-e2e-new", price: "500", minimum: "300" });
        await variant(1, "SKU").fill("dup-v1");
        await variant(1, "barcode").fill("dupcheck1");
        expect(await submitAndReadError()).toBe(
          "That SKU or barcode is already used by another product.",
        );
        expect(await count()).toBe(before);
        createRequest = requests
          .filter((r) => r.method === "POST" && r.body?.includes("dup-v1"))
          .at(-1);
        expect(createRequest).toBeDefined();
      });

      it("the create endpoint checks the real session itself and the CSRF origin", async () => {
        if (!createRequest) throw new Error("no captured create request");
        const before = await count();
        const fresh = {
          ...createRequest,
          body: createRequest.body?.replaceAll("LX-e2e-new", "lx-e2e-anon") ?? null,
        };
        const anonymous = await replay(fresh, { origin: "same" });
        expect(anonymous.text).toContain("Not signed in.");
        const forged = await replay(fresh, { origin: "same", cookie: "A".repeat(43) });
        expect(forged.text).toContain("Not signed in.");
        const token = (await sessionCookie())?.value ?? "";
        expect((await replay(fresh, { origin: "cross", cookie: token })).status).toBe(403);
        expect(await count()).toBe(before);
      });

      it("server-controlled fields sent to the real endpoint are rejected", async () => {
        if (!createRequest?.body) throw new Error("no captured create request");
        const token = (await sessionCookie())?.value ?? "";
        const before = await count();
        // Rename real keys in the captured request so the server receives stock/active/id fields.
        for (const [from, to] of [
          ['"lowStockThreshold"', '"stock"'],
          ['"description"', '"active"'],
          ['"name"', '"id"'],
          ['"barcode"', '"openingStock"'], // inside the variant object
        ] as const) {
          const body = createRequest.body
            .replaceAll("LX-e2e-new", "lx-e2e-field")
            .replace(from, to);
          expect(body).toContain(to);
          const r = await replay({ ...createRequest, body }, { origin: "same", cookie: token });
          expect(r.text).toMatch(/Unrecognized key|Required|incorrect|must be/i);
        }
        expect(await count()).toBe(before);
      });

      it("5 simultaneous identical creates save exactly one product; same for a shared barcode", async () => {
        const template = createRequest;
        if (!template?.body) throw new Error("no captured create request");
        const token = (await sessionCookie())?.value ?? "";
        const body = template.body;
        const same = body.replaceAll("LX-e2e-new", "lx-e2e-race");
        await Promise.all(
          Array.from({ length: 5 }, () =>
            replay({ ...template, body: same }, { origin: "same", cookie: token }),
          ),
        );
        expect(await count({ sku: "LX-E2E-RACE" })).toBe(1);
        // Different SKUs, one shared barcode (sent in different letter case).
        await Promise.all(
          Array.from({ length: 5 }, (_, i) =>
            replay(
              {
                ...template,
                body: body
                  .replaceAll("LX-e2e-new", `lx-e2e-r${i}`)
                  .replaceAll("dup-v1", `r${i}-v`)
                  .replaceAll("dupcheck1", i % 2 ? "racebc77" : "RACEBC77"),
              },
              { origin: "same", cookie: token },
            ),
          ),
        );
        expect(await count({ "variants.barcode": "RACEBC77" })).toBe(1);
      });

      it("ends signed out", async () => {
        await loginPage.goto(`${base}/login`, { waitUntil: "networkidle" });
        await loginPage.getByTestId("logout-button").click();
        await loginPage.waitForSelector('[data-testid="login-form"]');
        expect(await sessionCookie()).toBeUndefined();
      });
    });

    // ---- /owner/products: edit, archive, restore (real-owner-only; there is no delete) ----
    describe("/owner/products edit and archive", () => {
      const SECRET_COST = 333_333; // satang (฿3,333.33); distinctive, so any leak is detectable
      let robeId = "";
      let scarfId = "";

      const row = (name: string) =>
        loginPage.locator('[data-testid="product-row"]', { hasText: name });
      const stored = (id: string) => {
        if (!conn) throw new Error("no test db");
        return productModel(conn).findById(id).select("+costSatang").lean();
      };
      /** Records, from now on, whether any element matching `selector` ever renders `text`. */
      const watchFor = (selector: string, text: string) =>
        loginPage.evaluate(
          ([sel, t]) => {
            const w = window as Window & { __seen?: { armed: boolean; shown: boolean } };
            const state = { armed: false, shown: false };
            w.__seen = state;
            new MutationObserver(() => {
              if (
                state.armed &&
                [...document.querySelectorAll(sel)].some((el) => el.textContent?.trim() === t)
              )
                state.shown = true;
            }).observe(document.body, { subtree: true, childList: true, characterData: true });
          },
          [selector, text] as const,
        );
      const arm = () =>
        loginPage.evaluate(() => {
          const w = window as Window & { __seen?: { armed: boolean; shown: boolean } };
          if (w.__seen) w.__seen.armed = true;
        });
      const seen = () =>
        loginPage.evaluate(() => {
          const w = window as Window & { __seen?: { armed: boolean; shown: boolean } };
          return w.__seen;
        });

      beforeAll(async () => {
        if (!conn) throw new Error("no test db");
        const products = createProductService(conn);
        const robe = await products.createProduct({
          name: "E2E Robe",
          sku: "LX-E2E-ROBE",
          category: "accessories",
          priceSatang: 150000,
          minimumSellingPriceSatang: 100000,
          costSatang: SECRET_COST,
          lowStockThreshold: 1,
          variants: [{ sku: "LX-E2E-ROBE" }],
        });
        const scarf = await products.createProduct({
          name: "E2E Scarf",
          sku: "LX-E2E-SCARF",
          category: "accessories",
          priceSatang: 69000,
          minimumSellingPriceSatang: 49000,
          lowStockThreshold: 1,
          variants: [{ sku: "LX-E2E-SCARF" }],
        });
        if (!robe.ok || !scarf.ok) throw new Error("test product setup failed");
        robeId = robe.data.id;
        scarfId = scarf.data.id;
      });

      it("signed out: the edit page redirects to sign-in", async () => {
        const res = await fetch(`${base}/owner/products/${robeId}/edit`, { redirect: "manual" });
        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(400);
        expect(res.headers.get("location")).toMatch(/\/login\?redirect=%2Fowner%2Fproducts$/);
        expectSecured(res.headers, "/owner/products/$id/edit redirect");
      });

      it("edit: prefilled without cost; the list shows the new values immediately, never the old ones", async () => {
        await loginPage.goto(`${base}/login?redirect=%2Fowner%2Fproducts`, {
          waitUntil: "networkidle",
        });
        await submitLogin(EMAIL, PASSWORD);
        await loginPage.waitForURL(`${base}/owner/products`);
        await row("E2E Robe").waitFor();
        await watchFor('[data-testid="product-row"] td:first-child', "E2E Robe");
        const firstResponse = responses.length;
        await row("E2E Robe").getByTestId("product-edit").click();
        await loginPage.waitForURL(`${base}/owner/products/${robeId}/edit`);
        await loginPage.waitForSelector('[data-testid="ep-submit"]:not([disabled])');
        expect(await loginPage.getByTestId("ep-name").inputValue()).toBe("E2E Robe");
        expect(await loginPage.getByTestId("ep-sku").inputValue()).toBe("LX-E2E-ROBE");
        expect(await loginPage.getByTestId("ep-sku").isDisabled()).toBe(true);
        expect(await loginPage.getByTestId("ep-price").inputValue()).toBe("1500.00");
        expect(await loginPage.getByTestId("ep-minimum").inputValue()).toBe("1000.00");
        expect(await loginPage.getByTestId("ep-cost").inputValue()).toBe("");
        expect(await loginPage.content()).not.toContain(String(SECRET_COST));
        const ssr = await html(`/owner/products/${robeId}/edit`, (await sessionCookie())?.value);
        expect(ssr).toMatch(/<form[^>]*method="post"/);
        expect(ssr.match(/<button[^>]*data-testid="ep-submit"[^>]*>/)?.[0]).toMatch(
          /\sdisabled=""/,
        );
        expect(ssr).not.toContain(String(SECRET_COST));

        await loginPage.getByTestId("ep-name").fill("E2E Kimono");
        await loginPage.getByTestId("ep-category").selectOption("dresses");
        await loginPage.getByTestId("ep-price").fill("1,800.50");
        await loginPage.getByTestId("ep-minimum").fill("1200.25");
        await arm();
        await loginPage.getByTestId("ep-submit").click();
        await loginPage.waitForURL(`${base}/owner/products`);
        await row("E2E Kimono").waitFor({ timeout: 5000 });
        expect(await seen()).toEqual({ armed: true, shown: false });
        expect((await row("E2E Kimono").locator("td").allTextContents()).slice(0, 5)).toEqual([
          "E2E Kimono",
          "LX-E2E-ROBE",
          "Dresses",
          "฿1,800.50",
          "฿1,200.25",
        ]);
        // Stored as integer satang; an empty cost field kept the stored cost.
        expect(await stored(robeId)).toMatchObject({
          name: "E2E Kimono",
          category: "dresses",
          priceSatang: 180_050,
          minimumSellingPriceSatang: 120_025,
          costSatang: SECRET_COST,
        });
        for (const body of responses.slice(firstResponse)) {
          expect(body).not.toContain(String(SECRET_COST));
          expect(body).not.toContain('"cost');
        }
      });

      it("edit: invalid values show the server's message and save nothing", async () => {
        const before = await stored(robeId);
        await loginPage.goto(`${base}/owner/products/${robeId}/edit`, { waitUntil: "networkidle" });
        await loginPage.waitForSelector('[data-testid="ep-submit"]:not([disabled])');
        await loginPage.getByTestId("ep-minimum").fill("5000");
        await loginPage.getByTestId("ep-submit").click();
        await loginPage.getByTestId("ep-error").waitFor();
        expect(await loginPage.getByTestId("ep-error").textContent()).toBe(
          "Minimum selling price cannot be higher than the selling price.",
        );
        await loginPage.getByTestId("ep-minimum").fill("1200");
        await loginPage.getByTestId("ep-price").fill("99.505");
        await loginPage.getByTestId("ep-submit").click();
        await loginPage.waitForFunction(() =>
          document
            .querySelector('[data-testid="ep-error"]')
            ?.textContent?.includes("Use at most 2 decimal places"),
        );
        expect(await stored(robeId)).toEqual(before);
      });

      it("archive asks for confirmation; Cancel keeps the product, Archive removes it from the active list", async () => {
        await loginPage.goto(`${base}/owner/products`, { waitUntil: "networkidle" });
        await loginPage.waitForSelector('[data-testid="product-archive"]:not([disabled])');
        await row("E2E Scarf").getByTestId("product-archive").click();
        await loginPage.getByTestId("archive-dialog").waitFor();
        expect(await loginPage.getByTestId("archive-dialog").textContent()).toContain(
          "Archive E2E Scarf?",
        );
        await loginPage.getByTestId("archive-cancel").click();
        await loginPage.getByTestId("archive-dialog").waitFor({ state: "detached" });
        expect((await stored(scarfId))?.active).toBe(true);
        expect(await row("E2E Scarf").count()).toBe(1);

        await row("E2E Scarf").getByTestId("product-archive").click();
        await loginPage.getByTestId("archive-confirm").click();
        await loginPage.getByTestId("archive-dialog").waitFor({ state: "detached" });
        // The dialog closes only after the fresh list has loaded: the row is already gone.
        expect(await row("E2E Scarf").count()).toBe(0);
        expect(await stored(scarfId)).toMatchObject({ active: false, name: "E2E Scarf" });
        await loginPage.reload({ waitUntil: "networkidle" });
        await loginPage.waitForSelector('[data-testid="products-table"]');
        expect(await row("E2E Scarf").count()).toBe(0);
        expect(await row("E2E Kimono").count()).toBe(1);
      });

      it("archived products are viewable and can be restored to the active list", async () => {
        await loginPage.getByTestId("view-archived").click();
        await loginPage.waitForURL(`${base}/owner/products?view=archived`);
        await loginPage.waitForSelector('[data-testid="products-table"][data-view="archived"]');
        expect(
          await loginPage.locator('[data-testid="product-row"] td:first-child').allTextContents(),
        ).toEqual(["E2E Scarf"]);
        expect((await row("E2E Scarf").locator("td").allTextContents())[6]).toBe("Archived");
        await loginPage.waitForSelector('[data-testid="product-restore"]:not([disabled])');
        await row("E2E Scarf").getByTestId("product-restore").click();
        await loginPage.getByTestId("products-empty").waitFor();
        expect(await loginPage.getByTestId("products-empty").textContent()).toBe(
          "No archived products.",
        );
        expect((await stored(scarfId))?.active).toBe(true);
        await loginPage.getByTestId("view-active").click();
        await loginPage.waitForURL(`${base}/owner/products`);
        await loginPage.waitForSelector('[data-testid="products-table"][data-view="active"]');
        expect(await row("E2E Scarf").count()).toBe(1);
      });

      it("edit and archive endpoints check the real session, the CSRF origin and the fields", async () => {
        const update = requests
          .filter((r) => r.method === "POST" && r.body?.includes("E2E Kimono"))
          .at(-1);
        const archive = requests
          .filter((r) => r.method === "POST" && r.body?.includes(scarfId))
          .at(0);
        if (!update?.body || !archive) throw new Error("no captured edit/archive request");
        const token = (await sessionCookie())?.value ?? "";
        const hijack = { ...update, body: update.body.replace("E2E Kimono", "E2E Hijacked") };
        for (const req of [hijack, archive]) {
          expect((await replay(req, { origin: "same" })).text).toContain("Not signed in.");
          const forged = await replay(req, { origin: "same", cookie: "A".repeat(43) });
          expect(forged.text).toContain("Not signed in.");
          expect((await replay(req, { origin: "cross", cookie: token })).status).toBe(403);
        }
        expect(await stored(robeId)).toMatchObject({ name: "E2E Kimono" });
        expect((await stored(scarfId))?.active).toBe(true);
        // Server-controlled fields in the update are rejected, even for the signed-in owner.
        for (const [from, to] of [
          ['"lowStockThreshold"', '"stock"'],
          ['"description"', '"active"'],
          ['"name"', '"sku"'],
        ] as const) {
          const body = update.body.replace(from, to);
          expect(body).toContain(to);
          const r = await replay({ ...update, body }, { origin: "same", cookie: token });
          expect(r.text).toMatch(/Unrecognized key/);
        }
        expect(await stored(robeId)).toMatchObject({ name: "E2E Kimono", active: true });
      });

      it("ends signed out", async () => {
        await loginPage.goto(`${base}/login`, { waitUntil: "networkidle" });
        await loginPage.getByTestId("logout-button").click();
        await loginPage.waitForSelector('[data-testid="login-form"]');
        expect(await sessionCookie()).toBeUndefined();
      });
    });

    it("sign out everywhere ends this browser's session and the owner's session on another device", async () => {
      if (!browser || !conn) throw new Error("no browser or test db");
      const sessions = sessionModel(conn);
      const stored = (token: string) =>
        sessions.findById(createHash("sha256").update(token).digest("hex")).lean();
      await loginPage.goto(`${base}/login`, { waitUntil: "networkidle" });
      await submitLogin(EMAIL, PASSWORD);
      await loginPage.getByTestId("signed-in").waitFor();
      // A second device: its own browser context, so its own cookie jar.
      const other = await browser.newContext();
      try {
        const otherPage = await other.newPage();
        await otherPage.goto(`${base}/login?redirect=%2Fowner%2Fproducts`, {
          waitUntil: "networkidle",
        });
        await otherPage.waitForSelector('[data-testid="login-submit"]:not([disabled])');
        await otherPage.getByTestId("login-email").fill(EMAIL);
        await otherPage.getByTestId("login-password").fill(PASSWORD);
        await otherPage.getByTestId("login-submit").click();
        await otherPage.waitForURL(`${base}/owner/products`);
        const here = (await sessionCookie())?.value;
        const there = (await other.cookies()).find((c) => c.name === COOKIE)?.value;
        if (!here || !there) throw new Error("both devices should be signed in");
        // Each session records the login address and browser (stored, never logged).
        for (const token of [here, there]) {
          const doc = await stored(token);
          expect(doc?.createdIp).toMatch(/127\.0\.0\.1/);
          expect(doc?.userAgent).toMatch(/Chrome/);
          expect(doc?.lastSeenAt).toBeInstanceOf(Date);
        }

        await loginPage.getByTestId("logout-everywhere-button").click();
        await loginPage.waitForSelector('[data-testid="login-form"]');
        expect(new URL(loginPage.url()).pathname).toBe("/login");
        expect(await sessionCookie()).toBeUndefined();
        expect(await stored(here)).toBeNull();
        expect(await stored(there)).toBeNull();
        expect(await sessions.countDocuments()).toBe(0);
        // The other device is signed out as well.
        await otherPage.goto(`${base}/owner/products`);
        await otherPage.waitForURL(`${base}/login?redirect=%2Fowner%2Fproducts`);
      } finally {
        await other.close();
      }
    });

    // ---- INTERIM Quick Sales (decision 0004): staff flow, owner day page, n8n API ----
    describe("interim Quick Sales (staff, /owner/today, /api/daily-summary)", () => {
      let staffCtx: BrowserContext;
      let staff: Page;
      let staff2Ctx: BrowserContext;
      let staff2: Page;
      let ownerCtx: BrowserContext;
      let owner: Page;
      /** Server-function responses seen by each staff member's own browser. */
      const staffResponses: Record<"one" | "two", string[]> = { one: [], two: [] };
      /** The exported name of a captured dev-mode server function ("<name>_createServerFn_handler"). */
      const fnName = (url: string) => {
        const id = new URL(url).pathname.split("/").at(-1) ?? "";
        try {
          const parsed: unknown = JSON.parse(Buffer.from(id, "base64url").toString("utf8"));
          return typeof parsed === "object" && parsed !== null && "export" in parsed
            ? String(parsed.export)
            : "";
        } catch {
          return "";
        }
      };
      const watch = (p: Page, staffBucket?: "one" | "two") => {
        p.on("request", (r) => {
          if (r.url().includes("/_serverFn"))
            requests.push({
              url: r.url(),
              method: r.method(),
              headers: r.headers(),
              body: r.postData(),
            });
        });
        p.on("response", async (r) => {
          if (!r.url().includes("/_serverFn")) return;
          const text = await r.text().catch(() => "");
          responses.push(text);
          if (staffBucket) staffResponses[staffBucket].push(text);
        });
      };
      const signInAt = async (p: Page, email: string) => {
        await p.goto(`${base}/login`, { waitUntil: "networkidle" });
        await p.waitForSelector('[data-testid="login-submit"]:not([disabled])');
        await p.getByTestId("login-email").fill(email);
        await p.getByTestId("login-password").fill(PASSWORD);
        await p.getByTestId("login-submit").click();
      };
      const cookieOf = async (ctx: BrowserContext) =>
        (await ctx.cookies()).find((c) => c.name === COOKIE)?.value ?? "";
      const addSale = async (p: Page, item: string, amount: string, pay: "cash" | "qr") => {
        await p.waitForSelector('[data-testid="qs-add"]:not([disabled])');
        await p.getByTestId("qs-item").fill(item);
        await p.getByTestId("qs-amount").fill(amount);
        await p.getByTestId(`qs-${pay}`).click();
        await p.getByTestId("qs-add").click();
        await p.getByTestId("qs-saved").waitFor();
      };
      const sales = () => {
        if (!conn) throw new Error("no test db");
        return quickSaleModel(conn);
      };

      beforeAll(async () => {
        if (!browser) throw new Error("no browser");
        staffCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
        staff = await staffCtx.newPage();
        watch(staff, "one");
        staff2Ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
        staff2 = await staff2Ctx.newPage();
        watch(staff2, "two");
        ownerCtx = await browser.newContext();
        owner = await ownerCtx.newPage();
        watch(owner);
      });

      afterAll(async () => {
        await staffCtx?.close();
        await staff2Ctx?.close();
        await ownerCtx?.close();
      });

      it("signed out, /quick-sales and /owner/today redirect to /login", async () => {
        for (const path of ["/quick-sales", "/owner/today"]) {
          const res = await fetch(`${base}${path}`, { redirect: "manual" });
          expect(res.status, path).toBe(307);
          expect(res.headers.get("location"), path).toMatch(/\/login$/);
          expectSecured(res.headers, `${path} signed out`);
        }
      });

      it("staff sign in at /login and land on /quick-sales: first only the opening-change form, no links", async () => {
        await signInAt(staff, STAFF_EMAIL);
        await staff.waitForURL(`${base}/quick-sales`);
        await staff.getByTestId("qs-opening-form").waitFor();
        expect(await staff.getByText("Change money in bag (฿)").isVisible()).toBe(true);
        expect(await staff.getByTestId("qs-sale-form").count()).toBe(0);
        expect(await staff.locator("a[href]").count()).toBe(0);
        // Opening /login again while signed in goes straight back.
        await staff.goto(`${base}/login`);
        await staff.waitForURL(`${base}/quick-sales`);
      });

      it("records the opening change once; a second one (replayed, or another staff member) is refused", async () => {
        await staff.waitForSelector('[data-testid="qs-opening-save"]:not([disabled])');
        await staff.getByTestId("qs-opening").fill("1,000");
        await staff.getByTestId("qs-opening-save").click();
        await staff.getByTestId("qs-sale-form").waitFor();
        const opening = requests
          .filter((r) => fnName(r.url).startsWith("recordOpeningFloat"))
          .at(-1);
        if (!opening) throw new Error("no captured opening request");
        const again = await replay(opening, { origin: "same", cookie: await cookieOf(staffCtx) });
        expect(again.text).toContain("Today's change money is already recorded.");
        await signInAt(staff2, STAFF2_EMAIL);
        await staff2.waitForURL(`${base}/quick-sales`);
        await staff2.getByTestId("qs-sale-form").waitFor();
        expect(await staff2.getByTestId("qs-opening-form").count()).toBe(0);
      });

      it("adds sales with decimals: Saved ✓ and the own entry listed; bad input saves nothing", async () => {
        await addSale(staff, "Silk scarf", "1,800.50", "cash");
        const rows = staff.getByTestId("qs-recent-row");
        await expect.poll(() => rows.count()).toBe(1);
        expect(await rows.first().textContent()).toMatch(/Silk scarf.*Cash · ฿1,800\.50/);
        // No payment chosen.
        await staff.getByTestId("qs-item").fill("No payment");
        await staff.getByTestId("qs-amount").fill("10");
        await staff.getByTestId("qs-add").click();
        await expect
          .poll(() => staff.getByTestId("qs-error").textContent())
          .toBe("Choose Cash or QR.");
        // Three decimals: the server's parser refuses it.
        await staff.getByTestId("qs-amount").fill("1.005");
        await staff.getByTestId("qs-qr").click();
        await staff.getByTestId("qs-add").click();
        await expect
          .poll(() => staff.getByTestId("qs-error").textContent())
          .toBe("Use at most 2 decimal places (satang).");
        expect(await sales().countDocuments()).toBe(1);
        expect(await sales().findOne({ itemText: "Silk scarf" }).lean()).toMatchObject({
          amountSatang: 180050,
          payment: "cash",
          cancelled: false,
        });
        await addSale(staff, "Belt", "99.99", "qr");
        await addSale(staff2, "Linen bag", "2500", "qr");
      });

      it("cancels an own sale within 10 minutes; someone else's or an older one is refused", async () => {
        const belt = staff.getByTestId("qs-recent-row").filter({ hasText: "Belt" });
        await belt.getByTestId("qs-cancel").click();
        await staff.getByTestId("qs-cancel-confirm").click();
        await expect.poll(() => belt.textContent()).toMatch(/Cancelled/);
        expect(await belt.getByTestId("qs-cancel").count()).toBe(0);
        expect(await sales().findOne({ itemText: "Belt" }).lean()).toMatchObject({
          cancelled: true,
          cancelledAt: expect.any(Date),
        });
        // Replay the cancel with the other staff member's sale id.
        const cancel = requests.filter((r) => fnName(r.url).startsWith("cancelQuickSale")).at(-1);
        const theirs = await sales().findOne({ itemText: "Linen bag" }).lean();
        const beltDoc = await sales().findOne({ itemText: "Belt" }).lean();
        if (!cancel?.body || !theirs || !beltDoc) throw new Error("no cancel request or sale");
        const hijack = { ...cancel, body: cancel.body.replace(beltDoc._id, theirs._id) };
        expect(hijack.body).toContain(theirs._id);
        const refused = await replay(hijack, { origin: "same", cookie: await cookieOf(staffCtx) });
        expect(refused.text).toContain("This sale can no longer be cancelled.");
        expect(await sales().findById(theirs._id).lean()).toMatchObject({ cancelled: false });
        // An own sale older than 10 minutes: not listed any more, and cancelling it is refused.
        await addSale(staff, "Old item", "10", "cash");
        const old = await sales().findOne({ itemText: "Old item" }).lean();
        if (!old) throw new Error("no old item");
        await sales().updateOne(
          { _id: old._id },
          { $set: { createdAt: new Date(Date.now() - 11 * 60 * 1000) } },
        );
        await staff.reload({ waitUntil: "networkidle" });
        await staff.getByTestId("qs-sale-form").waitFor();
        expect(await staff.getByTestId("qs-recent").textContent()).not.toContain("Old item");
        const late = { ...cancel, body: cancel.body.replace(beltDoc._id, old._id) };
        expect(
          (await replay(late, { origin: "same", cookie: await cookieOf(staffCtx) })).text,
        ).toContain("This sale can no longer be cancelled.");
        expect(await sales().findById(old._id).lean()).toMatchObject({ cancelled: false });
      });

      it("staff pages and responses never show totals or other people's sales", async () => {
        const text = (await staff.content()) + staffResponses.one.join("\n");
        for (const forbidden of [
          "Linen bag",
          "E2E Staff Two",
          "totalSatang",
          "cashSatang",
          "qrSatang",
          "openingFloatSatang",
          "expectedCashSatang",
          "cancelledCount",
          "staffName",
          "userId",
          "usr_",
          "100000", // the opening change in satang
          "฿1,000.00",
          "Total",
        ])
          expect(text, forbidden).not.toContain(forbidden);
        const other = (await staff2.content()) + staffResponses.two.join("\n");
        for (const forbidden of [
          "Silk scarf",
          "Belt",
          "totalSatang",
          "cashSatang",
          "staffName",
          "usr_",
        ])
          expect(other, forbidden).not.toContain(forbidden);
      });

      it("staff are refused on every owner page, every product function, and never reach the demo", async () => {
        for (const path of [
          "/owner/products",
          "/owner/products?view=archived",
          "/owner/products/new",
          `/owner/products/${productId}/edit`,
          "/owner/today",
          "/",
          "/pos",
          "/sales",
          "/dashboard",
          "/products",
        ]) {
          await staff.goto(`${base}${path}`);
          await expect
            .poll(() => new URL(staff.url()).pathname, { message: path, timeout: 15_000 })
            .toBe("/quick-sales");
          await staff.getByTestId("qs-sale-form").waitFor();
          const html = await staff.content();
          expect(html, path).not.toContain("E2E Towel");
          expect(html, path).not.toContain("Demo role");
        }
        // Every captured owner product function, replayed with the staff cookie.
        const productFns = [
          "getProductForOwner",
          "listProductsForOwner",
          "createProductForOwner",
          "getProductForEditing",
          "updateProductForOwner",
          "archiveProductForOwner",
          "restoreProductForOwner",
        ];
        const cookie = await cookieOf(staffCtx);
        const seen = new Set<string>();
        for (const req of requests) {
          const name = productFns.find((f) => fnName(req.url).startsWith(`${f}_`));
          if (!name || seen.has(name)) continue;
          seen.add(name);
          const r = await replay(req, { origin: "same", cookie });
          expect(r.text, name).toContain("Not allowed.");
          expect(r.text, name).not.toContain("E2E Towel");
        }
        expect([...seen].sort()).toEqual([...productFns].sort());
      });

      it("the owner sees /owner/today: totals, expected cash, every sale with staff and status", async () => {
        await signInAt(owner, EMAIL);
        await owner.getByTestId("owner-today-link").click();
        await owner.waitForURL(`${base}/owner/today`);
        await owner.getByTestId("today-sales").waitFor();
        const stat = (id: string) => owner.getByTestId(id).textContent();
        expect(await stat("today-opening")).toBe("฿1,000.00");
        expect(await stat("today-total")).toBe("฿4,310.50");
        expect(await stat("today-cash")).toBe("฿1,810.50");
        expect(await stat("today-qr")).toBe("฿2,500.00");
        expect(await stat("today-count")).toBe("3");
        expect(await stat("today-cancelled")).toBe("1");
        expect(await stat("today-expected-cash")).toBe("฿2,810.50");
        const rows = await owner.getByTestId("today-row").allTextContents();
        expect(rows).toHaveLength(4);
        const row = (item: string) => rows.find((r) => r.includes(item)) ?? "";
        // Time, item, amount, payment, staff, status.
        expect(row("Silk scarf")).toMatch(/^\d\d:\d\dSilk scarf฿1,800\.50CashE2E StaffOK$/);
        expect(row("Linen bag")).toMatch(/^\d\d:\d\dLinen bag฿2,500\.00QRE2E Staff TwoOK$/);
        expect(row("Belt")).toMatch(/^\d\d:\d\dBelt฿99\.99QRE2E StaffCancelled$/);
        expect(row("Old item")).toMatch(/^\d\d:\d\dOld item฿10\.00CashE2E StaffOK$/);
        // The date picker: an earlier day is empty.
        await owner.getByTestId("today-date").fill("2026-01-15");
        await owner.waitForURL(`${base}/owner/today?date=2026-01-15`);
        await owner.getByTestId("today-empty").waitFor();
        expect(await stat("today-opening")).toBe("Not recorded");
        expect(await stat("today-total")).toBe("฿0.00");
      });

      it("GET /api/daily-summary: refused without a valid token (also with a session cookie); the token works", async () => {
        const url = `${base}/api/daily-summary`;
        const ownerCookie = `${COOKIE}=${await cookieOf(ownerCtx)}`;
        for (const headers of [
          {},
          { cookie: ownerCookie },
          { authorization: "Bearer short" },
          { authorization: `Bearer ${SUMMARY_TOKEN.slice(0, -1)}x` },
          { authorization: `Basic ${SUMMARY_TOKEN}` },
        ] as Record<string, string>[]) {
          const res = await fetch(url, { headers });
          const text = await res.text();
          responses.push(text);
          expect(res.status, JSON.stringify(Object.keys(headers))).toBe(401);
          expect(JSON.parse(text)).toEqual({ error: "Not allowed." });
          expectSecured(res.headers, "api refused");
        }
        const res = await fetch(url, { headers: { authorization: `Bearer ${SUMMARY_TOKEN}` } });
        expect(res.status).toBe(200);
        expectSecured(res.headers, "api ok");
        expect(res.headers.get("set-cookie")).toBeNull();
        const body: unknown = await res.json();
        const kept = await sales().find({ cancelled: false }).sort({ createdAt: 1, _id: 1 }).lean();
        expect(body).toEqual({
          date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          openingFloatSatang: 100000,
          totalSatang: 431050,
          cashSatang: 181050,
          qrSatang: 250000,
          count: 3,
          cancelledCount: 1,
          sales: kept.map((s) => ({
            time: bangkokTime(s.createdAt),
            itemText: s.itemText,
            amountSatang: s.amountSatang,
            payment: s.payment,
          })),
        });
        expect(kept.map((s) => s.itemText)).toEqual(["Old item", "Silk scarf", "Linen bag"]);
      });

      it("failed API attempts are rate-limited per address: 10 failures, then 429 even with the token", async () => {
        const url = `${base}/api/daily-summary`;
        // 5 failures were counted above; 5 more reach the limit of 10.
        for (let i = 0; i < 5; i++)
          expect((await fetch(url, { headers: { authorization: "Bearer wrong" } })).status).toBe(
            401,
          );
        const blocked = await fetch(url, { headers: { authorization: `Bearer ${SUMMARY_TOKEN}` } });
        expect(blocked.status).toBe(429);
        expect(await blocked.json()).toEqual({ error: "Too many attempts. Try again later." });
        // Login uses its own limits: the owner can still sign in.
        await owner.goto(`${base}/login`, { waitUntil: "networkidle" });
        await owner.getByTestId("signed-in").waitFor();
      });

      it("staff log out from /quick-sales", async () => {
        await staff.getByTestId("qs-logout").click();
        await staff.waitForURL(`${base}/login`);
        await staff.getByTestId("login-form").waitFor();
        expect(await cookieOf(staffCtx)).toBe("");
      });
    });

    it("5 failed logins block further attempts, even with the right password", async () => {
      for (let i = 0; i < 5; i++) await signIn(EMAIL, `wrong-password-${i}`);
      expect(JSON.parse(await signIn())).toEqual({
        ok: false,
        error: "Too many attempts. Try again later.",
      });
    });

    it("spoofed CF-Connecting-IP / X-Forwarded-For are ignored off Cloudflare: still blocked", async () => {
      // The last request is the correct-password login refused above. Were either header
      // trusted, it would count as a fresh address and sign in.
      const loginReq = requests.filter((r) => r.method === "POST").at(-1);
      if (!loginReq) throw new Error("no login request captured");
      for (const name of ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"]) {
        const spoofed = await replay(loginReq, {
          origin: "same",
          extraHeaders: { [name]: "198.51.100.77" },
        });
        expect(spoofed.status).toBe(200);
        expect(spoofed.text).toContain("Too many attempts. Try again later.");
        expect(spoofed.headers.get("set-cookie")).toBeNull();
      }
    });

    it("/login shows the too-many-attempts message after 5 failures", async () => {
      await loginPage.goto(`${base}/login`, { waitUntil: "networkidle" });
      await submitLogin(EMAIL, PASSWORD);
      await expect
        .poll(() => loginPage.getByTestId("login-error").textContent())
        .toBe("Too many attempts. Try again later.");
    });

    it("the demo is unchanged: landing page cards + sign-in link, and /pos still works", async () => {
      const demo = await context.newPage();
      await demo.goto(`${base}/`, { waitUntil: "networkidle" });
      expect(await demo.getByText("Choose a demo account to continue.").isVisible()).toBe(true);
      const link = demo.getByTestId("owner-signin-link");
      expect(await link.textContent()).toBe("Owner sign-in (real account)");
      expect(await link.getAttribute("href")).toBe("/login");
      await demo.getByRole("button", { name: /Employee/ }).click();
      await demo.waitForURL(`${base}/pos`);
      await demo.getByLabel("Search products").first().waitFor();
      expect(await demo.getByRole("group", { name: "Demo role" }).isVisible()).toBe(true);
      // The demo product page still works under the simulated Owner role, from browser data.
      await demo
        .getByRole("group", { name: "Demo role" })
        .getByRole("button", { name: "owner" })
        .click();
      await demo.goto(`${base}/products`, { waitUntil: "networkidle" });
      // The demo catalogue is sorted and paginated; its header always shows the product count.
      await demo.getByText(/^24 products · \d+ variants$/).waitFor();
      // Choosing a simulated demo role never creates a real session.
      expect(await sessionCookie()).toBeUndefined();
      await demo.close();
    });

    it("no browser response contains stack traces, file paths or database details", () => {
      expect(responses.length).toBeGreaterThan(10);
      for (const body of responses) expect(body).not.toMatch(LEAK);
    });

    it("/login handles an unreachable database with a friendly message (stops the test DB)", async () => {
      await server?.stop();
      // A stored cookie makes the loader query the database; it must degrade gracefully.
      const page1 = await html("/login", "A".repeat(43));
      expect(page1).toContain("temporarily unavailable");
      expect(page1).not.toMatch(LEAK);
      const newForm = await html("/owner/products/new", "A".repeat(43));
      expect(newForm).toContain('data-testid="new-product-unavailable"');
      expect(newForm).not.toMatch(LEAK);
      const products = await html("/owner/products", "A".repeat(43));
      expect(products).toContain('data-testid="products-error"');
      const down = await fetch(`${base}/owner/products`, {
        headers: { cookie: `${COOKIE}=${"A".repeat(43)}` },
      });
      await down.text();
      expectSecured(down.headers, "/owner/products, database down");
      expect(products).toContain("temporarily unavailable");
      expect(products).not.toMatch(LEAK);
      await loginPage.goto(`${base}/login`, { waitUntil: "networkidle" });
      await submitLogin("someone-else@example.invalid", PASSWORD); // not throttled: different email
      await expect
        .poll(() => loginPage.getByTestId("login-error").textContent(), { timeout: 20_000 })
        .toMatch(/temporarily unavailable/);
      for (const body of responses) expect(body).not.toMatch(LEAK);
    });

    it("the production build of the isolated copy keeps server code out of the browser bundle", async () => {
      const r = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
        cwd: copy,
        env: { PATH: process.env["PATH"] ?? "", HOME: tmpdir(), NO_COLOR: "1" },
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
      const files = readdirSync(join(copy, ".output/public"), { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".js"))
        .map((f) => readFileSync(join(copy, ".output/public", f), "utf8"));
      expect(files.length).toBeGreaterThan(0);
      for (const js of files)
        expect(js).not.toMatch(
          /mongoose|scrypt|timingSafeEqual|MONGODB_URI|passwordHash|luxe_session/,
        );
      // The build is a Node server (preset node-server). Start it with node, without any database
      // setting, and check the headers it sends itself: static files get the baseline from the
      // nitro.config.ts route rule, pages get it from src/server.ts, and no Cloudflare _headers
      // file is published.
      const asset = readdirSync(join(copy, ".output/public/assets")).find((f) => f.endsWith(".js"));
      if (!asset) throw new Error("no built asset");
      const builtPort = await freePort();
      const built = spawn(process.execPath, [".output/server/index.mjs"], {
        cwd: copy,
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: tmpdir(),
          NODE_ENV: "production",
          HOST: "127.0.0.1",
          PORT: String(builtPort),
        },
      });
      let builtOutput = "";
      built.stdout?.on("data", (d: Buffer) => (builtOutput += d.toString()));
      built.stderr?.on("data", (d: Buffer) => (builtOutput += d.toString()));
      try {
        const started = Date.now();
        while (!builtOutput.includes(`127.0.0.1:${builtPort}`)) {
          if (Date.now() - started > 30_000 || built.exitCode !== null)
            throw new Error("built server did not start");
          await new Promise((r) => setTimeout(r, 100));
        }
        const at = (path: string) => fetch(`http://127.0.0.1:${builtPort}${path}`);
        const page = await at("/login");
        await page.text();
        expect(page.status).toBe(200);
        expectSecured(page.headers, "built /login");
        for (const path of ["/favicon.ico", `/assets/${asset}`]) {
          const res = await at(path);
          await res.arrayBuffer();
          expect(res.status, path).toBe(200);
          for (const [name, value] of Object.entries(SECURITY_HEADERS))
            expect(res.headers.get(name), `built ${path}: ${name}`).toBe(value);
          expect(res.headers.get("cache-control"), path).not.toBe("no-store");
        }
        const hashed = await at(`/assets/${asset}`);
        await hashed.arrayBuffer();
        expect(hashed.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
        const headersFile = await at("/_headers");
        await headersFile.text();
        expect(headersFile.status).toBe(404);

        // CSRF on the built server: capture a real server-function request from its own login
        // page (no database is configured, so the login itself fails), then replay it.
        const builtPage = await context.newPage();
        const builtRequests: (typeof requests)[number][] = [];
        builtPage.on("request", (r) => {
          if (r.url().includes("/_serverFn") && r.method() === "POST")
            builtRequests.push({
              url: r.url(),
              method: r.method(),
              headers: r.headers(),
              body: r.postData(),
            });
        });
        try {
          await builtPage.goto(`http://127.0.0.1:${builtPort}/login`, { waitUntil: "networkidle" });
          await builtPage.waitForSelector('[data-testid="login-submit"]:not([disabled])');
          await builtPage.getByTestId("login-email").fill(EMAIL);
          await builtPage.getByTestId("login-password").fill("wrong-password-built");
          await builtPage.getByTestId("login-submit").click();
          await builtPage.getByTestId("login-error").waitFor();
        } finally {
          await builtPage.close();
        }
        const builtLogin = builtRequests[0];
        if (!builtLogin) throw new Error("no server-function request captured on the built server");
        expect((await replay(builtLogin, { origin: "cross" })).status).toBe(403);
        expect((await replay(builtLogin, { origin: "none" })).status).toBe(403);
        const sameOrigin = await replay(builtLogin, { origin: "same" });
        expect(sameOrigin.status).toBe(200);
        expect(sameOrigin.text).not.toMatch(LEAK);
      } finally {
        built.kill("SIGTERM");
      }
    }, 300_000);
  },
);

describe.skipIf(!ENABLED || HAVE_CHROME)("owner login e2e", () => {
  it.skip(`skipped: Google Chrome not found at ${CHROME} (set CHROME_PATH)`, () => {});
});
