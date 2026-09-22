import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import * as OTPAuth from "otpauth";

import { invalidateContentCache } from "../content/cache.js";
import { getDb } from "../db/client.js";
import { adminUsers } from "../db/schema.js";
import { hashPassword } from "../lib/password.js";
import { ADMIN_ORIGIN } from "./constants.js";

export const ADMIN_EMAIL = "admin@example.test";
export const ADMIN_PASSWORD = "correct horse battery staple";

/** Empties every application table; the drizzle schema (migration journal) is untouched. */
export async function resetDb(): Promise<void> {
  const db = getDb();
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (rows.length > 0) {
    const tables = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
    await db.execute(sql.raw(`truncate ${tables} restart identity cascade`));
  }
  invalidateContentCache();
}

export async function createAdmin(
  email = ADMIN_EMAIL,
  password = ADMIN_PASSWORD,
): Promise<string> {
  const [row] = await getDb()
    .insert(adminUsers)
    .values({ email, passwordHash: await hashPassword(password) })
    .returning({ id: adminUsers.id });
  return row!.id;
}

/** Code for the secret embedded in an otpauth:// URI, offset in 30s steps. */
export function totpCode(otpauthUri: string, stepOffset = 0): string {
  const totp = OTPAuth.URI.parse(otpauthUri) as OTPAuth.TOTP;
  return totp.generate({ timestamp: Date.now() + stepOffset * 30_000 });
}

type Body = Record<string, unknown> | FormData | undefined;

/**
 * Drives the app the way the admin panel does: a cookie jar, the trusted
 * Origin, and the CSRF cookie echoed as a header. Each client is one browser;
 * `ip` feeds x-forwarded-for, which the rate limiter keys on.
 */
export class TestClient {
  private readonly cookies = new Map<string, string>();
  /** Raw Set-Cookie headers of the most recent response. */
  lastSetCookies: string[] = [];

  constructor(
    private readonly app: Hono,
    private readonly ip = "203.0.113.10",
  ) {}

  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  async request(
    method: string,
    path: string,
    body?: Body,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const h = new Headers(headers);
    if (!h.has("origin")) h.set("origin", ADMIN_ORIGIN);
    h.set("x-forwarded-for", this.ip);

    const csrf = this.cookies.get("pf_csrf");
    if (csrf && !h.has("x-csrf-token")) h.set("x-csrf-token", csrf);
    if (this.cookies.size > 0) {
      h.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    }

    const init: RequestInit = { method, headers: h };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      h.set("content-type", "application/json");
      init.body = JSON.stringify(body);
    }

    const res = await this.app.request(path, init);
    this.absorb(res);
    return res;
  }

  get(path: string, headers?: Record<string, string>) {
    return this.request("GET", path, undefined, headers);
  }
  post(path: string, body: Body = {}, headers?: Record<string, string>) {
    return this.request("POST", path, body, headers);
  }
  put(path: string, body: Body = {}, headers?: Record<string, string>) {
    return this.request("PUT", path, body, headers);
  }
  patch(path: string, body: Body = {}, headers?: Record<string, string>) {
    return this.request("PATCH", path, body, headers);
  }
  delete(path: string, body?: Body, headers?: Record<string, string>) {
    return this.request("DELETE", path, body, headers);
  }

  async login(email = ADMIN_EMAIL, password = ADMIN_PASSWORD): Promise<Response> {
    return this.post("/auth/login", { email, password });
  }

  private absorb(res: Response): void {
    this.lastSetCookies = res.headers.getSetCookie();
    for (const raw of this.lastSetCookies) {
      const [pair = "", ...attributes] = raw.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const cleared = value === "" || attributes.some((a) => /^\s*max-age=0\s*$/i.test(a));
      if (cleared) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}
