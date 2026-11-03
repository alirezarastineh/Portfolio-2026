import { DOCUMENT } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from "@angular/core";
import { Router, RouterLink } from "@angular/router";

import { fmt } from "../i18n/interpolate";
import { pageUrl, siteOrigin } from "../seo/seo-meta";
import { LanguageService } from "../services/language.service";
import { answersByQuestion } from "./answers";
import { AskLauncherService } from "./ask-launcher.service";
import { AskStore } from "./ask.store";
import type { AskMessage } from "./ask-types";
import { handoffSummary } from "./handoff-offer";
import { linkPolicyFor } from "./link-policy";
import { matchData, stepLine, type MatchKind, type MatchStatus } from "./match";
import { MatchBoxComponent } from "./match-box.component";
import { MATCH_PAGE_COPY } from "./match-page-copy";
import { receiptClauses } from "./receipt";
import { plainText } from "./terminal-markdown";

/** A status as a mark beside its word, never as colour alone. */
const MARKS: Record<MatchStatus, { glyph: string; tone: string }> = {
  evidence: { glyph: "✓", tone: "text-available" },
  partial: { glyph: "~", tone: "text-accent-orange" },
  "not-published": { glyph: "–", tone: "text-muted-foreground" },
};

/**
 * The match page's working part (plan 3 W3), loaded after hydration: the
 * paste box, the step while it runs, then the tab's latest match (the page's
 * or the terminal's: one conversation) as a table of the server's rows, its
 * receipt, a print-only line with the AI disclosure, and the hand-off, read
 * from the answer itself, so a reload or a later answer keeps it.
 */
@Component({
  selector: "app-match-panel",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatchBoxComponent, RouterLink],
  host: { class: "flex flex-col gap-6" },
  template: `
    <!-- Only while the sheet is closed: open, the terminal's live region says it. -->
    <p class="sr-only" role="status">{{ said() }}</p>

    @if (on()) {
      <app-match-box class="match-controls" [kind]="kind()" [page]="true" (sent)="send($event)" />
    } @else if (store.remote()) {
      <p class="m-0 text-muted-foreground">
        {{ store.copy().match.off }}
        <a class="link-underline" [routerLink]="['/', lang.lang()]" fragment="contact">{{
          copy().contact
        }}</a>
      </p>
    }

    @if (step(); as line) {
      <p class="m-0 font-mono text-sm text-muted-foreground" aria-hidden="true" data-match-progress>
        {{ line }}
      </p>
    }
    @if (failure(); as line) {
      <p class="m-0 text-destructive">{{ line }}</p>
    }

    @if (latest(); as match) {
      @if (match.lead) {
        <p class="m-0 leading-relaxed text-foreground">{{ match.lead }}</p>
      }
      @if (match.data; as data) {
        <!-- Scrolls sideways on a phone; focusable, so the keyboard can scroll it too. -->
        <div class="overflow-x-auto" role="region" tabindex="0" aria-labelledby="match-caption">
          <table class="w-full min-w-xl border-collapse text-left text-sm">
            <caption id="match-caption" class="sr-only">
              {{
                copy().caption
              }}
            </caption>
            <thead>
              <tr class="border-b border-border text-muted-foreground">
                <th scope="col" class="py-2 pr-4 font-normal">{{ copy().columns.status }}</th>
                <th scope="col" class="py-2 pr-4 font-normal">
                  {{ copy().columns.item[data.kind] }}
                </th>
                <th scope="col" class="py-2 pr-4 font-normal">{{ copy().columns.shows }}</th>
                <th scope="col" class="py-2 font-normal">{{ copy().columns.evidence }}</th>
              </tr>
            </thead>
            <tbody>
              @for (row of data.items; track row.n) {
                <tr class="border-b border-border align-top">
                  <td class="whitespace-nowrap py-3 pr-4">
                    <span aria-hidden="true" [class]="marks[row.status].tone">{{
                      marks[row.status].glyph
                    }}</span>
                    {{ row.statusLabel }}
                  </td>
                  <th scope="row" class="py-3 pr-4 font-medium text-foreground">
                    {{ row.text }}
                    @if (row.priorityLabel) {
                      <span class="font-normal text-muted-foreground"
                        >({{ row.priorityLabel }})</span
                      >
                    }
                  </th>
                  <td class="py-3 pr-4 leading-relaxed">{{ row.summary }}</td>
                  <td class="py-3">
                    <ul class="m-0 flex list-none flex-col gap-1 p-0">
                      @for (cite of row.cites; track cite.id) {
                        <li>
                          <a
                            class="link-underline"
                            [href]="cite.url"
                            (click)="follow($event, cite.url)"
                            >{{ cite.title }}</a
                          >
                        </li>
                      }
                    </ul>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      @if (match.receipt) {
        <p class="m-0 text-xs text-muted-foreground" data-receipt>
          <span aria-hidden="true"># </span>{{ match.receipt }}
        </p>
      }
      <p class="match-print-only m-0 hidden text-xs">{{ match.printed }}</p>
      <div class="match-controls flex flex-wrap gap-3">
        @if (match.handoff) {
          <button
            type="button"
            class="press min-h-8 cursor-pointer rounded-md border border-border px-3 hover:border-accent-orange"
            (click)="store.handOff(match.message)"
          >
            {{ copy().handoff }}
          </button>
        }
        @if (match.data) {
          <button
            type="button"
            class="press min-h-8 cursor-pointer rounded-md border border-border px-3 hover:border-accent-orange"
            (click)="print()"
          >
            {{ copy().print }}
          </button>
          <button
            type="button"
            class="press min-h-8 cursor-pointer rounded-md border border-border px-3 hover:border-accent-orange"
            (click)="clear()"
          >
            {{ copy().clear }}
          </button>
        }
      </div>
    }
  `,
})
export class MatchPanelComponent {
  readonly kind = input.required<MatchKind>();

  protected readonly store = inject(AskStore);
  protected readonly lang = inject(LanguageService);
  private readonly launcher = inject(AskLauncherService);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);

  protected readonly copy = computed(() => MATCH_PAGE_COPY[this.lang.lang()]);
  protected readonly marks = MARKS;
  /** While the server offers it: off by the owner's switch, or the trust check's demotion. */
  protected readonly on = computed(() => this.store.remote()?.match === true);
  private readonly busy = computed(() =>
    ["submitted", "streaming"].includes(this.store.chat.status),
  );
  private readonly linkPolicy = computed(() => linkPolicyFor(this.lang.content()));

  /** The tab's latest match. */
  private readonly entry = computed(() =>
    this.store.entries().findLast((e) => e.kind === "ask" && !!e.match),
  );

  /** The step it is on while it runs; its start until the server names one. */
  protected readonly step = computed(() => {
    const entry = this.entry();
    const answering = this.store.entries().findLast((e) => e.kind === "ask");
    if (!entry || !this.busy() || answering?.id !== entry.id) return null;
    const copy = this.store.copy().match;
    const progress = this.store.matchStep();
    return progress?.entryId === entry.id ? stepLine(progress.step, copy.steps) : copy.started;
  });

  protected readonly failure = computed(() => {
    const entry = this.entry();
    return entry?.kind === "ask" && entry.failure
      ? this.store.messageFor(entry.failure, entry.retryAfter)
      : null;
  });

  protected readonly latest = computed(() => {
    const entry = this.entry();
    const message =
      entry?.kind === "ask" ? answersByQuestion(this.store.chat.messages).get(entry.userId) : null;
    if (!message) return null;
    const text = message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n\n");
    const locale = this.lang.lang();
    const day = new Date(message.metadata?.createdAt ?? Date.now());
    return {
      message: message as AskMessage,
      data: matchData(message, this.linkPolicy()),
      // The counts and the summary, or a stopped match's line; what they cite, the table lists.
      lead: plainText(text.split("\n\n")[0] ?? ""),
      receipt: receiptClauses(message.metadata, this.store.copy().receipt).join(" · "),
      handoff: handoffSummary(message) !== null,
      printed: fmt(this.copy().printed, {
        date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(day),
        url: pageUrl(siteOrigin(this.lang.content()), locale, "/match"),
      }),
    };
  });

  /** The live region's words: the terminal's announcements, while its own region is closed. */
  protected readonly said = signal("");

  constructor() {
    let seen = this.store.announcement();
    effect(() => {
      const text = this.store.announcement();
      if (text === seen) return;
      seen = text;
      if (!untracked(this.launcher.sheetOpen)) this.said.set(text);
    });
  }

  /** One request at a time, as the terminal's prompt sends. */
  protected send(brief: string): void {
    if (!this.busy()) void this.store.sendMatch(this.kind(), brief, "page");
  }

  /** The site's own pages through the router; a file (the CV) and a modified click as links do. */
  protected follow(event: MouseEvent, url: string): void {
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (modified || event.button !== 0 || url.startsWith("/media/")) return;
    event.preventDefault();
    void this.router.navigateByUrl(url);
  }

  protected print(): void {
    this.doc.defaultView?.print();
  }

  protected clear(): void {
    this.store.clearMatch();
    this.said.set(this.copy().cleared);
  }
}
