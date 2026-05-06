import { Injectable } from "@angular/core";

export interface ContactPayload {
  name: string;
  email: string;
  message: string;
  website?: string;
}

export type ContactResult = { ok: true } | { ok: false; error: string };

/** Empty string = same-origin `/contact` (Vite dev proxy or unified deploy). */
function resolveBaseUrl(): string {
  const meta = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const fromEnv = meta?.["VITE_API_BASE_URL"];
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/+$/, "");
  return "";
}

@Injectable({ providedIn: "root" })
export class ContactService {
  private readonly baseUrl = resolveBaseUrl();

  async send(payload: ContactPayload): Promise<ContactResult> {
    try {
      const url = this.baseUrl ? `${this.baseUrl}/contact` : "/contact";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        return { ok: false, error: data?.error ?? "network_error" };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: "network_error" };
    }
  }
}
