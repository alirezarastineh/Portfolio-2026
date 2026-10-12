import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";

import { AdminApiService } from "../admin-api.service";
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
 * the skill (a new version) or stops using it.
 */
@Component({
  selector: "app-assistant-copilot",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmBadge],
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-4" aria-labelledby="assistant-copilot">
      <div class="flex flex-col gap-1">
        <h2 id="assistant-copilot" class="m-0 text-sm font-medium">The copilot's skills</h2>
        @if (view(); as v) {
          <p class="m-0 text-xs text-muted-foreground">
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
            class="flex flex-col gap-3 rounded-lg border border-border p-3"
            [attr.aria-labelledby]="'copilot-skill-' + skill.id"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <h3 [id]="'copilot-skill-' + skill.id" class="m-0 text-sm font-medium">
                {{ name(skill.id) }}
              </h3>
              <span class="font-mono text-xs text-muted-foreground"
                >version {{ skill.version }}</span
              >
            </div>
            <p class="m-0 text-sm">{{ skill.description }}</p>
            <dl class="m-0 grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
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

            <div class="overflow-x-auto rounded-md border border-border">
              <table class="w-full text-sm">
                <caption class="sr-only">
                  {{
                    name(skill.id)
                  }}: what became of its drafts, per version
                </caption>
                <thead class="text-left text-xs text-muted-foreground">
                  <tr>
                    <th class="p-2 font-normal">Version</th>
                    <th class="p-2 text-right font-normal">Drafts</th>
                    <th class="p-2 text-right font-normal">Kept as written</th>
                    <th class="p-2 text-right font-normal">Edited</th>
                    <th class="p-2 text-right font-normal">Discarded</th>
                    <th class="p-2 text-right font-normal">Abstained</th>
                    <th class="p-2 text-right font-normal">Waiting</th>
                    <th class="p-2 text-right font-normal">Keep rate</th>
                    <th class="p-2 text-right font-normal">Edit rate</th>
                    <th class="p-2 text-right font-normal">Median edit</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of skill.versions; track row.version) {
                    <tr class="border-t border-border font-mono text-xs">
                      <th scope="row" class="p-2 text-left font-normal">
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
                      <td class="p-2 text-right">{{ row.uses }}</td>
                      <td class="p-2 text-right">{{ row.kept }}</td>
                      <td class="p-2 text-right">{{ row.edited }}</td>
                      <td class="p-2 text-right">{{ row.discarded }}</td>
                      <td class="p-2 text-right">{{ row.abstained }}</td>
                      <td class="p-2 text-right">{{ row.waiting }}</td>
                      <td class="p-2 text-right">{{ percent(row.keepRate) }}</td>
                      <td class="p-2 text-right">{{ percent(row.editRate) }}</td>
                      <td class="p-2 text-right">{{ median(row) }}</td>
                    </tr>
                  }
                  <!-- The agents' drafts, decided on their proposals: counted apart. -->
                  @for (row of skill.agent ?? []; track row.version) {
                    <tr class="border-t border-border font-mono text-xs">
                      <th scope="row" class="p-2 text-left font-normal">
                        {{ row.version }}
                        <span class="font-sans text-muted-foreground"
                          >{{ row.current ? "(current) " : "" }}· agent proposals</span
                        >
                        @if (row.flagged) {
                          <span hlmBadge variant="outline" class="ml-1 font-sans text-destructive"
                            >kept under {{ percent(v.rules.keepFloor) }}</span
                          >
                        }
                      </th>
                      <td class="p-2 text-right">{{ row.uses }}</td>
                      <td class="p-2 text-right">{{ row.kept }}</td>
                      <td class="p-2 text-right">{{ row.edited }}</td>
                      <td class="p-2 text-right">{{ row.discarded }}</td>
                      <td class="p-2 text-right">{{ row.abstained }}</td>
                      <td class="p-2 text-right">{{ row.waiting }}</td>
                      <td class="p-2 text-right">{{ percent(row.keepRate) }}</td>
                      <td class="p-2 text-right">{{ percent(row.editRate) }}</td>
                      <td class="p-2 text-right">{{ median(row) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <p class="m-0 text-xs text-muted-foreground">
              {{ verdict(skill.versions[0]!, v.rules) }}
            </p>
            <ul
              class="m-0 flex list-none flex-col gap-0.5 p-0 text-xs text-muted-foreground"
              [attr.aria-label]="name(skill.id) + ': how each version made its drafts'"
            >
              @for (row of skill.versions; track row.version) {
                <li>
                  <span class="font-mono">{{ row.version }}</span> · {{ checks(row, skill) }}
                </li>
              }
            </ul>

            <details class="text-xs">
              <summary class="cursor-pointer text-muted-foreground">
                What version {{ skill.version }} tells the model
              </summary>
              <pre
                class="m-0 mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-xs"
                >{{ skill.template }}</pre>
            </details>
          </article>
        }
      } @else if (failed()) {
        <p class="m-0 text-xs text-destructive">Could not load the copilot's skills.</p>
      } @else {
        <p class="m-0 text-xs text-muted-foreground">Loading…</p>
      }
    </section>
  `,
})
export class AssistantCopilotComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly view = signal<CopilotSkillsView | null>(null);
  protected readonly failed = signal(false);

  protected readonly name = skillName;
  protected readonly percent = percent;
  protected readonly verdict = verdictLine;
  protected readonly median = medianEdit;
  protected readonly models = modelsLabel;
  protected readonly gates = gateNames;
  protected readonly checks = checksLine;
  protected readonly leads = (ids: readonly string[]) => ids.map(leadName).join(", ");

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await this.api.copilotSkills();
    if (result.ok) {
      this.view.set(result.data);
      this.failed.set(false);
    } else {
      this.failed.set(true);
      toast.error("Could not load the copilot's skills", { description: result.error });
    }
  }
}
