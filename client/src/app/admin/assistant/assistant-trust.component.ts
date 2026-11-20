import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  OnInit,
  output,
  signal,
} from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";

import { AdminApiService } from "../admin-api.service";
import { apiWords } from "../api-words";
import type { AuditRow, Demotion, TrustView } from "../assistant-types";
import { ConfirmService } from "../components/confirm-dialog.component";
import { AdminPulseService } from "../pulse.service";
import { FormSkeletonComponent, LoadErrorComponent } from "../components/load-state.component";
import { WAITING_ROW } from "../now";
import { absoluteTime, relativeTime } from "../relative-time";
import { actionLabel, levelLabel, rulesLine, subjectLabel } from "../trust";
import {
  actionWords,
  actorWords,
  approverWords,
  auditAction,
  auditReason,
  auditTarget,
  outcomeWords,
} from "../trust-words";

/**
 * Trust (plan phase 14): what needs a person (alerts, demotions), the last
 * nightly check and what it considered, who may do what, and the audit log.
 * The monitor demotes a model or the deep route on stored evidence; only the
 * admin reinstates. No action here calls a model. In two parts (plan 5, U18):
 * what waits on Now, the rules in Settings.
 */
@Component({
  selector: "app-assistant-trust",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormSkeletonComponent, HlmBadge, HlmButton, LoadErrorComponent],
  host: { class: "flex flex-col gap-8" },
  template: `
    @if (loadError(); as reason) {
      <app-load-error compact title="Could not load trust" [reason]="reason" (retry)="reload()" />
    } @else if (!view()) {
      @if (part() === "rules") {
        <app-form-skeleton kind="list" [rows]="3" label="Loading trust…" />
      }
    } @else {
      @let v = view()!;
      @if (part() === "waiting") {
        <!-- Rows in Now's "Waits for you" (plan 5, U18), which says when nothing waits. -->
        <ul class="m-0 list-none p-0" role="list">
          @for (row of v.alerts; track row.id) {
            <li [class]="waitingRow">
              <div class="min-w-0">
                <p [id]="'trust-alert-' + row.id" class="m-0">
                  {{ first(action(row)) }}: {{ subject(row.target) }}
                </p>
                <p class="m-0 text-hint text-muted-foreground">
                  <time [attr.datetime]="row.at" [title]="absolute(row.at)">{{
                    first(relative(row.at))
                  }}</time>: {{ row.reason }}
                </p>
              </div>
              <button
                hlmBtn
                size="sm"
                variant="outline"
                type="button"
                [attr.aria-describedby]="'trust-alert-' + row.id"
                [disabled]="busy()"
                (click)="seen(row)"
              >
                Seen
              </button>
            </li>
          }
          @for (d of v.demoted; track d.subject) {
            <li [class]="waitingRow">
              <div class="min-w-0">
                <p [id]="'trust-demoted-' + $index" class="m-0">
                  {{ first(subject(d.subject)) }} is out of the visitors' service
                </p>
                <p class="m-0 text-hint text-muted-foreground">
                  Demoted
                  <time [attr.datetime]="d.at" [title]="absolute(d.at)">{{ relative(d.at) }}</time>:
                  {{ d.reason }}
                </p>
              </div>
              <button
                hlmBtn
                size="sm"
                variant="outline"
                type="button"
                [attr.aria-describedby]="'trust-demoted-' + $index"
                [disabled]="busy()"
                (click)="reinstate(d)"
              >
                Reinstate
              </button>
            </li>
          }
        </ul>
      } @else {
        <section class="flex flex-col gap-2" aria-labelledby="trust-check">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 id="trust-check" class="m-0 text-section-title">Nightly check</h2>
            <button
              hlmBtn
              size="sm"
              variant="outline"
              type="button"
              [disabled]="busy()"
              (click)="check()"
            >
              Check now
            </button>
          </div>
          <p class="m-0 max-w-prose text-hint text-pretty text-muted-foreground">
            {{ rules(v.rules) }}
          </p>
          @if (v.lastCheck; as last) {
            <p
              class="m-0 max-w-prose text-hint text-pretty text-muted-foreground"
              [title]="absolute(last.at)"
            >
              {{ relative(last.at) }}: {{ last.reason }}
            </p>
            <ul class="m-0 flex list-none flex-col gap-1 p-0 text-xs" role="list">
              @for (verdict of last.alternatives; track verdict.option) {
                <li>
                  <span class="font-data" translate="no">{{ verdict.option }}</span>:
                  <span class="text-muted-foreground">{{ verdict.why }}</span>
                </li>
              }
            </ul>
          } @else {
            <p class="m-0 text-hint text-muted-foreground">
              Not run yet: it runs at 03:00 UTC on the server, or now.
            </p>
          }
        </section>

        <section class="flex flex-col gap-2" aria-labelledby="trust-registry">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 id="trust-registry" class="m-0 text-section-title">Who may do what</h2>
            <!-- The server's own text, code paths and all, on request (plan 5, U19). -->
            <button
              type="button"
              class="min-h-6 touch-manipulation text-sm underline decoration-muted-foreground underline-offset-4 hover:decoration-foreground pointer-coarse:min-h-11"
              aria-controls="trust-registry-table"
              [attr.aria-expanded]="where()"
              (click)="where.set(!where())"
            >
              {{ where() ? "Hide where it is enforced" : "Show where it is enforced" }}
            </button>
          </div>
          <div class="overflow-x-auto rounded-lg border border-border">
            <table id="trust-registry-table" class="w-full text-sm">
              <caption class="sr-only">
                Each action, who does it, how far it may go alone, and who approves it
              </caption>
              <thead class="text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" class="p-2 font-normal">Who</th>
                  <th scope="col" class="p-2 font-normal">What</th>
                  <th scope="col" class="p-2 font-normal">Level</th>
                  <th scope="col" class="p-2 font-normal">Approves</th>
                </tr>
              </thead>
              <tbody>
                @for (entry of v.registry; track entry.action) {
                  <tr class="border-t border-border align-top">
                    <td class="p-2">{{ actor(entry) }}</td>
                    <td class="p-2">
                      {{ what(entry.action) }}
                      @if (!entry.built) {
                        <span hlmBadge variant="outline" class="ms-1">not built</span>
                      }
                      @if (where()) {
                        <span class="mt-1 block text-hint text-pretty text-muted-foreground">{{
                          entry.enforcement
                        }}</span>
                      }
                    </td>
                    <td class="p-2">{{ level(entry.level) }}</td>
                    <td class="p-2">{{ approver(entry.approver) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="flex flex-col gap-2" aria-labelledby="trust-log">
          <h2 id="trust-log" class="m-0 text-section-title">Audit log</h2>
          <div class="overflow-x-auto rounded-lg border border-border">
            <table class="w-full text-sm">
              <caption class="sr-only">
                What was done, by whom, and how it ended, newest first
              </caption>
              <thead class="text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" class="p-2 font-normal">When</th>
                  <th scope="col" class="p-2 font-normal">Who</th>
                  <th scope="col" class="p-2 font-normal">What</th>
                  <th scope="col" class="p-2 font-normal">Outcome and why</th>
                </tr>
              </thead>
              <tbody>
                @for (row of v.audit; track row.id) {
                  <tr class="border-t border-border align-top">
                    <td class="p-2 whitespace-nowrap" [title]="absolute(row.at)">
                      {{ relative(row.at) }}
                    </td>
                    <td class="p-2">{{ actor(row) }}</td>
                    <td class="p-2">
                      {{ happened(row) }}
                      @if (target(row.target); as t) {
                        <span
                          class="block text-muted-foreground"
                          [class.font-data]="t.id"
                          [attr.translate]="t.id ? 'no' : null"
                          [class.text-xs]="t.id"
                          >{{ t.text }}</span
                        >
                      }
                    </td>
                    <td class="p-2">
                      {{ outcome(row.decision) }}:
                      <span class="text-muted-foreground">{{ reason(row) }}</span>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td class="p-2 text-muted-foreground" colspan="4">Nothing yet.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    }
  `,
})
export class AssistantTrustComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  /** The sidebar's and the header's "needs a look" read the pulse: told at once. */
  private readonly pulse = inject(AdminPulseService);

  /** What waits for a person (Now), or the rules and the log (Settings). */
  readonly part = input<"waiting" | "rules">("rules");
  /** A row's Seen or Reinstate is done and its button gone: Now takes the focus. */
  readonly acted = output();

  protected readonly view = signal<TrustView | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  private gone = false;

  /** A row of Now's "Waits for you", as its own rows. */
  protected readonly waitingRow = WAITING_ROW;

  protected readonly level = levelLabel;
  protected readonly subject = subjectLabel;
  protected readonly action = actionLabel;
  protected readonly rules = rulesLine;
  /** The registry and the log in words (Settings). */
  protected readonly actor = actorWords;
  protected readonly what = actionWords;
  protected readonly approver = approverWords;
  protected readonly happened = auditAction;
  protected readonly target = auditTarget;
  protected readonly outcome = outcomeWords;
  protected readonly reason = auditReason;
  /** "Show where it is enforced": the registry's own text under each action. */
  protected readonly where = signal(false);

  /** "the deep route" → "The deep route": a row's words start a sentence. */
  protected first(words: string): string {
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.gone = true));
  }

  ngOnInit(): void {
    void this.load();
  }

  protected reload(): void {
    this.loadError.set(null);
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await this.api.assistantTrust();
    if (result.ok) {
      this.view.set(result.data);
    } else if (this.view()) {
      toast.error("Could not load trust", { description: apiWords(result.error) });
    } else {
      this.loadError.set(result.error);
    }
  }

  /** After an action: this view again, and the pulse, so the badges clear with it. */
  private async changed(): Promise<void> {
    await this.load();
    void this.pulse.refresh(["assistant"]);
  }

  protected async seen(row: AuditRow): Promise<void> {
    this.busy.set(true);
    const result = await this.api.trustAlertSeen(row.id);
    this.busy.set(false);
    if (!result.ok) {
      toast.error("Not marked seen", { description: apiWords(result.error) });
    }
    await this.changed();
    if (result.ok) {
      this.done();
    }
  }

  protected async reinstate(demotion: Demotion): Promise<void> {
    const go = await this.confirm.ask({
      title: `Reinstate ${subjectLabel(demotion.subject)}?`,
      description: `Visitors get it again at once. It was demoted because: ${demotion.reason}. The Playground, evals and pairwise runs still use it, so you can check it there first.`,
      confirmLabel: "Reinstate",
    });
    if (!go) {
      return;
    }
    this.busy.set(true);
    const result = await this.api.trustReinstate(demotion.subject);
    this.busy.set(false);
    if (!result.ok) {
      toast.error("Not reinstated", { description: apiWords(result.error) });
      return;
    }
    toast.success(`${subjectLabel(demotion.subject)} is back in service`);
    await this.changed();
    this.done();
  }

  /** Still here once the row is gone: Now moves the focus (plan 5, admin-ui.md). */
  private done(): void {
    if (!this.gone) {
      this.acted.emit();
    }
  }

  protected async check(): Promise<void> {
    this.busy.set(true);
    const result = await this.api.trustCheck();
    this.busy.set(false);
    if (!result.ok) {
      toast.error("The check did not run", { description: apiWords(result.error) });
      return;
    }
    const { checked, demoted, refused } = result.data;
    const refusals = refused.length ? `, ${refused.length} refused` : "";
    toast.success(`${checked} checked, ${demoted.length} demoted${refusals}`);
    await this.changed();
  }

  protected relative(iso: string): string {
    return relativeTime(iso);
  }

  protected absolute(iso: string): string {
    return absoluteTime(iso);
  }
}
