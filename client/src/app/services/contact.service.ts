import { Injectable, signal } from "@angular/core";

import { apiBaseUrl } from "./api-base";

export interface ContactPayload {
  name: string;
  email: string;
  message: string;
  website?: string;
  locale?: "en" | "de";
}

export type ContactResult = { ok: true } | { ok: false; error: string };

@Injectable({ providedIn: "root" })
export class ContactService {
  private readonly baseUrl = apiBaseUrl();

  /**
   * A message the assistant's hand-off wrote, waiting for the form to take it
   * (the form may not have hydrated yet). The visitor confirmed it first.
   */
  readonly prefill = signal<string | null>(null);

  async send(payload: ContactPayload): Promise<ContactResult> {
    try {
      const url = this.baseUrl ? `${this.baseUrl}/contact` : "/contact";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        return { ok: false, error: data?.error ?? "network_error" };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: "network_error" };
    }
  }
}
