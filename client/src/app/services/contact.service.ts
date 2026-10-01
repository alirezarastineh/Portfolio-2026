import { Injectable, signal } from "@angular/core";

import { apiBaseUrl } from "./api-base";

/** The assistant's answer a hand-off came from: the conversation that can be attached. */
export interface AskConversation {
  sessionId: string;
  messageId: string;
}

export interface ContactPayload {
  name: string;
  email: string;
  message: string;
  website?: string;
  locale?: "en" | "de";
  /** Only while Turnstile is on. */
  turnstileToken?: string;
  /** Sent through the assistant's hand-off. */
  origin?: "ask";
  /** Only when the visitor ticked "attach my conversation". */
  ask?: AskConversation;
}

export type ContactResult = { ok: true } | { ok: false; error: string };

/** What the assistant's hand-off leaves for the form. */
export interface ContactPrefill {
  text: string;
  /** The answer the hand-off came from; null for one that came from no answer. */
  ask: AskConversation | null;
}

@Injectable({ providedIn: "root" })
export class ContactService {
  private readonly baseUrl = apiBaseUrl();

  /**
   * A message the assistant's hand-off wrote, waiting for the form to take it
   * (the form may not have hydrated yet). The visitor confirmed it first.
   */
  readonly prefill = signal<ContactPrefill | null>(null);

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
