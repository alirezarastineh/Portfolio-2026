import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmTableImports } from "@spartan-ng/helm/table";

import { AdminApiService } from "../admin-api.service";
import { LoadErrorComponent } from "../components/load-state.component";
import {
  checksLine,
  gateNames,
  leadName,
  medianEdit,
  modelsLabel,
  percent,
  skillName,
  verdictLine,
  type CopilotSkillsView,
} from "../copilot-skills";

/**
 * Assistant → Copilot (plan phases 27–28): the editor copilot's skills, each
 * with what it does, when to use it, its checks, leads and current version,
 * and per version what became of its drafts and how they were made. The book's Skill Package deprecates on success rate;
 * here a version kept under the floor is flagged for the admin, who changes
 * the skill (a new version) or stops using it. A report in words (plan 5, U22):
 * each skill a heading over a ruled table, nothing boxed.
 */
@Component({
  selector: "app-assistant-copilot",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmBadge, HlmTableImports, LoadErrorComponent],
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="assistant-copilot">
      <div class="flex flex-col gap-1">
        <h2 #heading id="assistant-copilot" tabindex="-1" class="m-0 text-section-title">
          The copilot's skills
        </h2>
        @if (view(); as v) {
          <p class="m-0 max-w-prose text-hint text-muted-foreground">
            When you save, each draft the copilot wrote is judged against what you saved: kept (the
            same words), edited (at least half of its words kept, in order) or discarded. A
            version's keep rate counts kept and edited drafts of those decided; under
            {{ percent(v.rules.keepFloor) }} after {{ v.rules.minimumDecided }} decided drafts it is
            flagged. A changed prompt is a new version, counted afresh. Waiting: drafts whose editor
            has not saved yet, or could not report. The agents' drafts are counted apart, in rows
            marked "agent proposals": judged when you apply (as drafted or edited) or reject one.
          </p>
        }
      </div>

      @if (view(); as v) {
        @for (skill of v.skills; track skill.id) {
          <article
            class="flex flex-col gap-3 border-t border-border pt-4"
            [attr.aria-labelledby]="'copilot-skill-' + skill.id"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <h3 [id]="'copilot-skill-' + skill.id" class="m-0 text-sm font-medium">
                {{ name(skill.id) }}
              </h3>
              <span class="font-data text-xs text-muted-foreground" translate="no"
                >version {{ skill.version }}</span
              >
            </div>
            <p class="m-0 max-w-prose text-sm">{{ skill.description }}</p>
            <dl class="m-0 grid max-w-prose gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
              <dt class="text-muted-foreground">Used for</dt>
              <dd class="m-0">{{ skill.whenToUse }}</dd>
              <dt class="text-muted-foreground">Models</dt>
              <dd class="m-0">{{ models(skill.models) }}</dd>
              <dt class="text-muted-foreground">Checks</dt>
              <dd class="m-0">{{ gates(skill.gates) }}</dd>
              @if (skill.leads.length) {
                <dt class="text-muted-foreground">Drafts</dt>
                <dd class="m-0">
                  {{ skill.leads.length }}, each from its own angle ({{ leads(skill.leads) }}),
                  ranked by a second model
                </dd>
              }
              @if (skill.critic) {
                <dt class="text-muted-foreground">Second reading</dt>
                <dd class="m-0">Translations of 30 words or more, revised at most once</dd>
              }
            </dl>

            <div hlmTableContainer>
              <table hlmTable>
                <caption class="sr-only">
                  {{
                    name(skill.id)
                  }}: what became of its drafts, per version
                </caption>
                <thead hlmTHead>
                  <tr hlmTr>
                    <th hlmTh scope="col">Version</th>
                    <th hlmTh scope="col" class="text-right">Drafts</th>
                    <th hlmTh scope="col" class="text-right">Kept as written</th>
                    <th hlmTh scope="col" class="text-right">Edited</th>
                    <th hlmTh scope="col" class="text-right">Discarded</th>
                    <th hlmTh scope="col" class="text-right">Abstained</th>
                    <th hlmTh scope="col" class="text-right">Waiting</th>
                    <th hlmTh scope="col" class="text-right">Keep rate</th>
                    <th hlmTh scope="col" class="text-right">Edit rate</th>
                    <th hlmTh scope="col" class="text-right">Median edit</th>
                  </tr>
                </thead>
                <tbody hlmTBody>
                  @for (row of skill.versions; track row.version) {
                    <tr hlmTr class="font-data text-xs">
                      <th hlmTh scope="row" class="font-normal" translate="no">
                        {{ row.version }}
                        @if (row.current) {
                          <span class="font-sans text-muted-foreground">(current)</span>
                        }
                        @if (row.flagged) {
                          <!-- Outlined: the filled destructive badge is under 4.5:1 at this size. -->
                          <span hlmBadge variant="outline" class="ml-1 font-sans text-destructive"
                            >kept under {{ percent(v.rules.keepFloor) }}</span
                          >
                        }
                      </th>
                      <td hlmTd class="text-right">{{ row.uses }}</td>
                      <td hlmTd class="text-right">{{ row.kept }}</td>
                      <td hlmTd class="text-right">{{ row.edited }}</td>
                      <td hlmTd class="text-right">{{ row.discarded }}</td>
                      <td hlmTd class="text-right">{{ row.abstained }}</td>
                      <td hlmTd class="text-right">{{ row.waiting }}</td>
                      <td hlmTd class="text-right">{{ percent(row.keepRate) }}</td>
                      <td hlmTd class="text-right">{{ percent(row.editRate) }}</td>
                      <td hlmTd class="text-right">{{ median(row) }}</td>
                    </tr>
                  }
                  <!-- The agents' drafts, decided on their proposals: counted apart. -->
                  @for (row of skill.agent ?? []; track row.version) {
                    <tr hlmTr class="font-data text-xs">
                      <th hlmTh scope="row" class="font-normal" translate="no">
                        {{ row.version }}
                        <span class="font-sans text-muted-foreground"
                          >({{ row.current ? "current, " : "" }}agent proposals)</span
                        >
                        @if (row.flagged) {
                          <span hlmBadge variant="outline" class="ml-1 font-sans text-destructive"
                            >kept under {{ percent(v.rules.keepFloor) }}</span
                          >
                        }
                      </th>
                      <td hlmTd class="text-right">{{ row.uses }}</td>
                      <td hlmTd class="text-right">{{ row.kept }}</td>
                      <td hlmTd class="text-right">{{ row.edited }}</td>
                      <td hlmTd class="text-right">{{ row.discarded }}</td>
                      <td hlmTd class="text-right">{{ row.abstained }}</td>
                      <td hlmTd class="text-right">{{ row.waiting }}</td>
                      <td hlmTd class="text-right">{{ percent(row.keepRate) }}</td>
                      <td hlmTd class="text-right">{{ percent(row.editRate) }}</td>
                      <td hlmTd class="text-right">{{ median(row) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (skill.versions[0]; as latest) {
              <p class="m-0 text-hint text-muted-foreground">{{ verdict(latest, v.rules) }}</p>
            }
            <ul
              class="m-0 flex list-none flex-col gap-0.5 p-0 text-xs text-muted-foreground"
              [attr.aria-label]="name(skill.id) + ': how each version made its drafts'"
            >
              @for (row of skill.versions; track row.version) {
                <!-- Two columns, not a middle dot; &ngsp; keeps a space between them for readers. -->
                <li class="grid grid-cols-[auto_1fr] gap-x-3">
                  <span class="font-data" translate="no">{{ row.version }}</span>&ngsp;<span>{{
                    checks(row, skill)
                  }}</span>
                </li>
              }
            </ul>

            <details class="text-xs">
              <summary class="w-fit cursor-pointer text-muted-foreground">
                What version {{ skill.version }} tells the model
              </summary>
              <pre
                class="m-0 mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-xs"
                >{{ skill.template }}</pre>
            </details>
          </article>
        } @empty {
          <p class="m-0 text-hint text-muted-foreground">No skill yet.</p>
        }
      } @else if (loadError(); as code) {
        <app-load-error
          compact
          title="Could not load the copilot's skills"
          [reason]="code"
          [refocus]="heading"
          (retry)="reload()"
        />
      } @else {
        <p class="m-0 text-hint text-muted-foreground">Loading the copilot's skills…</p>
      }
    </section>
  `,
})
export class AssistantCopilotComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly view = signal<CopilotSkillsView | null>(null);
  /** Why the skills did not arrive (the API's code): said in their place, with Try again. */
  protected readonly loadError = signal<string | null>(null);

  protected readonly name = skillName;
  protected readonly percent = percent;
  protected readonly verdict = verdictLine;
  protected readonly median = medianEdit;
  protected readonly models = modelsLabel;
  protected readonly gates = gateNames;
  protected readonly checks = checksLine;
  protected readonly leads = (ids: readonly string[]) => ids.map((id) => leadName(id)).join(", ");

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await this.api.copilotSkills();
    // Loaded once: a failure is said in the skills' place, with Try again.
    this.loadError.set(result.ok ? null : result.error);
    if (result.ok) {
      this.view.set(result.data);
    }
  }

  protected reload(): void {
    void this.load();
  }
}
