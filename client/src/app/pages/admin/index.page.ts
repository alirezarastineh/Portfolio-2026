import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmAlert, HlmAlertDescription, HlmAlertTitle } from "@spartan-ng/helm/alert";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import {
  HlmCard,
  HlmCardContent,
  HlmCardDescription,
  HlmCardHeader,
  HlmCardTitle,
} from "@spartan-ng/helm/card";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";
import { HlmSpinner } from "@spartan-ng/helm/spinner";

import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import {
  AdminApiService,
  type AdminStatus,
  type MediaReconcile,
} from "../../admin/admin-api.service";

@Component({
  selector: "app-admin-dashboard",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmAlert,
    HlmAlertDescription,
    HlmAlertTitle,
    HlmBadge,
    HlmButton,
    HlmCard,
    HlmCardContent,
    HlmCardDescription,
    HlmCardHeader,
    HlmCardTitle,
    HlmSkeleton,
    HlmSpinner,
    RouterLink,
  ],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="m-0 font-mono text-2xl tracking-tight">Dashboard</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Edits are saved as a draft. Publishing makes them live.
          </p>
        </div>
        <button hlmBtn [disabled]="publishing()" (click)="publish()">
          @if (publishing()) {
            <hlm-spinner class="size-4" />
          } @else {
            Publish
          }
        </button>
      </header>

      @if (reconcile(); as r) {
        @if (r.missingFiles.length || r.orphanFiles.length) {
          <div hlmAlert variant="destructive">
            <h2 hlmAlertTitle>Media and database are out of step</h2>
            <p hlmAlertDescription>
              {{ r.missingFiles.length }} record(s) without a file,
              {{ r.orphanFiles.length }} file(s) without a record. Usually a
              database restore without a matching media restore.
              <a routerLink="/admin/media" class="underline underline-offset-4">Open media</a>
            </p>
          </div>
        }
      }

      @if (loading()) {
        <hlm-skeleton class="h-40 w-full" />
      } @else if (status(); as s) {
        <section hlmCard>
          <div hlmCardHeader>
            <h2 hlmCardTitle class="flex items-center gap-2 font-mono text-base">
              Draft state
              @if (s.hasUnpublishedChanges) {
                <span hlmBadge variant="default">unpublished changes</span>
              } @else {
                <span hlmBadge variant="secondary">published</span>
              }
            </h2>
            <p hlmCardDescription>
              {{
                s.hasUnpublishedChanges
                  ? "The draft is ahead of what visitors see."
                  : "Everything in the draft is live."
              }}
            </p>
          </div>
          <div hlmCardContent class="grid gap-4 sm:grid-cols-2">
            <div>
              <p class="m-0 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
                Last edit
              </p>
              <p class="m-0 mt-1 text-sm">{{ s.lastEdit ? formatDate(s.lastEdit) : "—" }}</p>
            </div>
            <div>
              <p class="m-0 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
                Last publish
              </p>
              <p class="m-0 mt-1 text-sm">{{ s.lastPublish ? formatDate(s.lastPublish) : "—" }}</p>
            </div>
          </div>
        </section>

        <section hlmCard>
          <div hlmCardHeader>
            <h2 hlmCardTitle class="font-mono text-base">Live versions</h2>
          </div>
          <div hlmCardContent class="flex flex-wrap gap-3">
            @for (p of s.pointers; track p.locale) {
              <div class="rounded-lg border border-border px-4 py-3">
                <p class="m-0 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  {{ p.locale }}
                </p>
                <p class="m-0 mt-1 font-mono text-sm">v{{ p.versionId }}</p>
              </div>
            }
          </div>
        </section>

        <section hlmCard>
          <div hlmCardHeader>
            <h2 hlmCardTitle class="font-mono text-base">Start editing</h2>
            <p hlmCardDescription>Every section is editable. Publish when you are happy.</p>
          </div>
          <div hlmCardContent class="flex flex-wrap gap-2">
            @for (link of quickLinks; track link.path) {
              <a hlmBtn variant="outline" size="sm" [routerLink]="link.path">{{ link.label }}</a>
            }
          </div>
        </section>
      } @else {
        <p class="text-sm text-muted-foreground">Could not load status.</p>
      }
    </div>
  `,
})
export default class AdminDashboardPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);

  protected readonly quickLinks = [
    { path: "/admin/hero", label: "Hero" },
    { path: "/admin/about", label: "Über mich" },
    { path: "/admin/projects", label: "Projects" },
    { path: "/admin/skills", label: "Skills" },
    { path: "/admin/seo", label: "SEO" },
    { path: "/admin/media", label: "Media" },
    { path: "/admin/revisions", label: "Revisions" },
  ];

  protected readonly status = signal<AdminStatus | null>(null);
  protected readonly reconcile = signal<MediaReconcile | null>(null);
  protected readonly loading = signal(true);
  protected readonly publishing = signal(false);

  ngOnInit(): void {
    void this.load();
    void this.loadReconcile();
  }

  /** Surfaced here because a restore mismatch is invisible until an image 404s. */
  private async loadReconcile(): Promise<void> {
    const result = await this.api.mediaReconcile();
    if (result.ok) this.reconcile.set(result.data);
  }

  protected formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }

  private async load(): Promise<void> {
    const result = await this.api.status();
    this.status.set(result.ok ? result.data : null);
    this.loading.set(false);
  }

  protected async publish(): Promise<void> {
    if (this.publishing()) return;

    // Publishing is what visitors see; make it a deliberate act rather than a
    // stray click, and say plainly what it does.
    const go = await this.confirm.ask({
      title: "Publish the draft?",
      description:
        "Both languages go live immediately. The current version is kept, so you can roll back from Revisions.",
      confirmLabel: "Publish",
    });
    if (!go) return;

    this.publishing.set(true);

    const result = await this.api.publish("admin");
    this.publishing.set(false);

    if (!result.ok) {
      toast.error("Publish failed", { description: result.error });
      return;
    }

    const versions = result.data.published.map((p) => `${p.locale} v${p.versionId}`).join(", ");
    toast.success("Published", { description: versions });
    await this.load();
  }
}
