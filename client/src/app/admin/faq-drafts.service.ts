import { Injectable, signal } from "@angular/core";

/**
 * The FAQ proposals drafted in this admin session (plan phase 31). A draft
 * takes up to a minute, and the admin may switch tabs meanwhile: the tab that
 * started it (Insights, the Journal) may be gone when it lands, and the FAQ
 * tab may be open on a list read before it. Insights and the Journal say when
 * one lands; the FAQ tab reads its list again.
 */
@Injectable({ providedIn: "root" })
export class FaqDraftsService {
  private readonly last = signal<{ id: string; n: number } | null>(null);
  private n = 0;

  /** The latest proposal drafted (or an open one returned), numbered in order. */
  readonly drafted = this.last.asReadonly();

  announce(id: string): void {
    this.last.set({ id, n: ++this.n });
  }
}
