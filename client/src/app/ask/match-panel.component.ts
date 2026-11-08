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
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideCheck, lucideContrast, lucideMessageCircle, lucideMinus } from "@ng-icons/lucide";

import { fmt } from "../i18n/interpolate";
import { pageUrl, siteOrigin } from "../seo/seo-meta";
import { LanguageService } from "../services/language.service";
import { answersByQuestion } from "./answers";
import { AskLauncherService } from "./ask-launcher.service";
import { AskStore } from "./ask.store";
import type { AskMessage } from "./ask-types";
import { handoffSummary } from "./handoff-offer";
import { linkPolicyFor } from "./link-policy";
import { markOf, matchData, stepLine, type MatchKind, type MatchMark } from "./match";
import { MatchBoxComponent } from "./match-box.component";
import { MATCH_PAGE_COPY } from "./match-page-copy";
import { receiptClauses } from "./receipt";
import { plainText } from "./terminal-markdown";

/** A status as an icon beside the server's word, never as colour alone. */
const MARKS: Record<MatchMark, { icon: string; tone: string }> = {
  evidence: { icon: "lucideCheck", tone: "text-available" },
  partial: { icon: "lucideContrast", tone: "text-accent-orange" },
  "not-published": { icon: "lucideMinus", tone: "text-muted-foreground" },
  ask: { icon: "lucideMessageCircle", tone: "text-muted-foreground" },
};

/**
 * The match page's working part (plan 3 W3), loaded after hydration: the
 * paste box, the step while it runs, then the tab's latest match (the page's
 * or the terminal's: one conversation) as a table of the server's rows (cards
 * on a phone), its receipt, a print-only line with the AI disclosure, and the
 * hand-off, read from the answer itself, so a reload or a later answer keeps it.
 */
@Component({
  selector: "app-match-panel",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatchBoxComponent, NgIcon, RouterLink],
  viewProviders: [provideIcons({ lucideCheck, lucideContrast, lucideMessageCircle, lucideMinus })],
  host: { class: "flex flex-col gap-6" },
  styles: `
    .report {
      width: 100%;
      max-width: 64rem;
      border-collapse: collapse;
      font-size: 0.9375rem;
      text-align: start;
      table-layout: fixed;
    }
    .report :is(th, td) {
      padding: 0.75rem 1rem 0.75rem 0;
      font-weight: 400;
      text-align: start;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    .report thead th {
      padding-block: 0.5rem;
      color: var(--muted-foreground);
    }
    .report thead th:nth-child(1) {
      width: 10rem;
    }
    .report thead th:nth-child(2) {
      width: 26%;
    }
    .report thead th:nth-child(4) {
      width: 24%;
    }
    .report tr {
      border-bottom: 1px solid var(--border);
    }
    .report tbody th {
      color: var(--foreground);
      font-weight: 600;
    }
    .report-status {
      display: flex;
      align-items: flex-start;
      gap: 0.375rem;
    }
    .report-status ng-icon {
      flex: none;
      margin-top: 0.1875rem;
    }
    /* A phone reads each row as a card: no sideways scroll. The roles keep it a table to a
       screen reader, which a CSS display of block would otherwise take away. */
    @media (width < 40rem) {
      .report,
      .report tbody,
      .report tr,
      .report :is(th, td) {
        display: block;
      }
      .report thead {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
      }
      .report tbody tr {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding-block: 1rem;
      }
      .report :is(th, td) {
        padding: 0;
      }
      .report td:empty {
        display: none;
      }
    }
  `,
  template: `
    <!-- Only while the sheet is closed: open, the terminal's live region says it. -->
    <p class="sr-only" role="status">{{ said() }}</p>

    @if (on()) {
      <app-match-box
        class="match-controls"
        [kind]="kind()"
        [page]="true"
        [busy]="busy()"
        (sent)="send($event)"
      />
    } @else if (store.remote() || store.configFailed()) {
      <p class="m-0 text-muted-foreground">
        {{ store.copy().match.off }}
        <a class="link-underline" [routerLink]="['/', lang.lang()]" fragment="contact">{{
          copy().contact
        }}</a>
      </p>
    } @else {
      <p class="match-frame m-0">{{ copy().loading }}</p>
    }

    @if (step(); as line) {
      <p
        class="m-0 text-small text-muted-foreground first-letter:uppercase"
        aria-hidden="true"
        data-match-progress
      >
        {{ line }}
      </p>
    }
    @if (refused() ?? failure(); as line) {
      <p class="m-0 max-w-3xl text-destructive">{{ line }}</p>
    }

    @if (latest(); as match) {
      @if (match.lead) {
        <p class="m-0 max-w-[68ch] text-lead text-foreground">{{ match.lead }}</p>
      }
      @if (match.data; as data) {
        <table class="report" role="table" aria-labelledby="match-caption">
          <caption id="match-caption" class="sr-only">
            {{
              copy().caption
            }}
          </caption>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">{{ copy().columns.status }}</th>
              <th role="columnheader" scope="col">{{ copy().columns.item[data.kind] }}</th>
              <th role="columnheader" scope="col">{{ copy().columns.shows }}</th>
              <th role="columnheader" scope="col">{{ copy().columns.evidence }}</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            @for (row of data.items; track row.n) {
              @let mark = marks[markOf(row)];
              <tr role="row">
                <td role="cell">
                  <span class="report-status">
                    <ng-icon [name]="mark.icon" size="16" aria-hidden="true" [class]="mark.tone" />
                    <span class="first-letter:uppercase">{{ row.statusLabel }}</span>
                  </span>
                </td>
                <th role="rowheader" scope="row">
                  {{ row.text }}
                  @if (row.priorityLabel) {
                    <span class="font-normal text-muted-foreground">({{ row.priorityLabel }})</span>
                  }
                </th>
                <td role="cell" class="first-letter:uppercase">{{ row.summary }}</td>
                <td role="cell">
                  @if (row.cites.length) {
                    <ul class="m-0 flex list-none flex-col gap-1 p-0">
                      @for (cite of row.cites; track cite.id) {
                        <li>
                          <a
                            class="link-underline inline-flex items-center pointer-coarse:min-h-11"
                            [href]="cite.url"
                            (click)="follow($event, cite.url)"
                            >{{ cite.title }}</a
                          >
                        </li>
                      }
                    </ul>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
      @if (match.receipt) {
        <p class="m-0 text-data text-muted-foreground" data-receipt>{{ match.receipt }}</p>
      }
      <p class="match-print-only m-0 hidden text-xs">{{ match.printed }}</p>
      <div class="match-controls flex flex-wrap items-center gap-x-3 gap-y-2">
        @if (match.handoff) {
          <button type="button" class="btn btn-solid press" (click)="store.handOff(match.message)">
            {{ copy().handoff }}
          </button>
        }
        @if (match.data) {
          <button type="button" class="btn btn-secondary press" (click)="print()">
            {{ copy().print }}
          </button>
          <button type="button" class="btn btn-quiet press" (click)="clear()">
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
  protected readonly markOf = markOf;
  /** While the server offers it: off by the owner's switch, or the trust check's demotion. */
  protected readonly on = computed(() => this.store.remote()?.match === true);
  protected readonly busy = computed(() =>
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

  /** Why the store sent nothing (rate limited, resting): it says so only in the terminal's log. */
  protected readonly refused = signal<string | null>(null);

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
      receipt: receiptClauses(message.metadata, this.store.copy().receipt).join(", "),
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
  protected async send(brief: string): Promise<void> {
    if (this.busy()) return;
    this.refused.set(null);
    await this.store.sendMatch(this.kind(), brief, "page");
    const last = this.store.entries().at(-1);
    if (last?.kind === "local" && last.input === `match ${this.kind()}`) {
      this.refused.set(last.lines[0]?.text ?? null);
    }
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
    this.refused.set(null);
    this.said.set(this.copy().cleared);
  }
}
