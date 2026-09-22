import { HttpClient, HttpErrorResponse, HttpEventType } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

import type { AppContent, Locale } from "../content/schema";

export interface AdminUser {
  id: string;
  email: string;
  totpEnrolled: boolean;
}

export interface AdminStatus {
  user: AdminUser;
  pointers: { locale: Locale; versionId: number; publishedAt: string }[];
  lastEdit: string | null;
  lastPublish: string | null;
  hasUnpublishedChanges: boolean;
}

export interface AdminSessionRow {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

export interface RevisionRow {
  id: number;
  locale: Locale;
  checksum: string;
  label: string | null;
  createdAt: string;
  live: boolean;
}

export interface RevisionDetail {
  revision: RevisionRow & { payload: AppContent };
  /** What is live for the same locale right now; null before the first publish. */
  live: { id: number; payload: AppContent } | null;
}

/** Discriminated so callers handle failure explicitly rather than by try/catch. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

/**
 * Talks to the credentialed admin surface on the API. The base URL is the
 * browser-facing one — unlike public content, these calls never run during SSR
 * (the guard defers everything to the browser, where the session cookie lives).
 */
@Injectable({ providedIn: "root" })
export class AdminApiService {
  private readonly http = inject(HttpClient);

  readonly baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "")
    .trim()
    .replace(/\/$/, "");

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  async request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    try {
      const data = await firstValueFrom(
        this.http.request<T>(method, this.url(path), {
          body,
          // The interceptor adds credentials and the CSRF header.
          responseType: "json",
        }),
      );
      return { ok: true, data: data as T };
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        const code =
          (error.error as { error?: string } | null)?.error ??
          (error.status ? `http_${error.status}` : "request_failed");
        return { ok: false, error: code, status: error.status };
      }
      return { ok: false, error: "network_error", status: 0 };
    }
  }

  /* ---- auth ---- */

  login(email: string, password: string) {
    return this.request<{ ok: true; totpRequired: boolean; user: AdminUser | null }>(
      "POST",
      "/auth/login",
      { email, password },
    );
  }

  verifyTotp(code: string) {
    return this.request<{ ok: true; user: AdminUser }>("POST", "/auth/totp", { code });
  }

  me() {
    return this.request<{ user: AdminUser; pendingTotp: boolean; csrfToken: string }>(
      "GET",
      "/auth/me",
    );
  }

  logout(all = false) {
    return this.request<{ ok: true }>("POST", `/auth/logout${all ? "?all=1" : ""}`, {});
  }

  sessions() {
    return this.request<{ sessions: AdminSessionRow[] }>("GET", "/auth/sessions");
  }

  revokeSession(id: string) {
    return this.request<{ ok: true }>("DELETE", `/auth/sessions/${id}`);
  }

  changePassword(currentPassword: string, newPassword: string) {
    return this.request<{ ok: true }>("POST", "/auth/password", {
      currentPassword,
      newPassword,
    });
  }

  totpSetup(password: string) {
    return this.request<{ otpauthUri: string; qrSvg: string }>("POST", "/auth/totp/setup", {
      password,
    });
  }

  totpConfirm(code: string) {
    return this.request<{ ok: true; recoveryCodes: string[] }>("POST", "/auth/totp/confirm", {
      code,
    });
  }

  totpDisable(password: string, code: string) {
    return this.request<{ ok: true }>("DELETE", "/auth/totp", { password, code });
  }

  /* ---- content ---- */

  status() {
    return this.request<AdminStatus>("GET", "/admin/status");
  }

  preview(locale: Locale) {
    return this.request<AppContent>("GET", `/admin/content/preview/${locale}`);
  }

  publish(label?: string) {
    return this.request<{ ok: true; published: { locale: Locale; versionId: number }[] }>(
      "POST",
      "/admin/publish",
      label ? { label } : {},
    );
  }

  revisions() {
    return this.request<{ revisions: RevisionRow[] }>("GET", "/admin/revisions");
  }

  revision(id: number) {
    return this.request<RevisionDetail>("GET", `/admin/revisions/${id}`);
  }

  rollback(id: number) {
    return this.request<{ ok: true; locale: Locale; versionId: number }>(
      "POST",
      `/admin/revisions/${id}/rollback`,
      {},
    );
  }

  /* ---- section documents ---- */

  getSection<T>(section: string) {
    return this.request<{ section: string; updatedAt: string | null; data: Record<Locale, T> }>(
      "GET",
      `/admin/sections/${section}`,
    );
  }

  putSection<T>(section: string, data: Record<Locale, T>, updatedAt: string | null) {
    return this.request<{ ok: true; updatedAt: string }>("PUT", `/admin/sections/${section}`, {
      data,
      updatedAt,
    });
  }

  /* ---- identity ---- */

  getProfile() {
    return this.request<{ profile: ProfileRow }>("GET", "/admin/profile");
  }

  putProfile(profile: ProfileInput) {
    return this.request<{ ok: true }>("PUT", "/admin/profile", profile);
  }

  /* ---- collections ---- */

  listSocials() {
    return this.request<{ socials: SocialRow[] }>("GET", "/admin/socials");
  }

  createSocial(input: SocialInput) {
    return this.request<{ ok: true; social: SocialRow }>("POST", "/admin/socials", input);
  }

  updateSocial(id: string, input: SocialInput) {
    return this.request<{ ok: true }>("PUT", `/admin/socials/${id}`, input);
  }

  deleteSocial(id: string) {
    return this.request<{ ok: true }>("DELETE", `/admin/socials/${id}`);
  }

  listSkills() {
    return this.request<{ skills: SkillRow[] }>("GET", "/admin/skills");
  }

  createSkill(input: SkillInput) {
    return this.request<{ ok: true; id: string }>("POST", "/admin/skills", input);
  }

  updateSkill(id: string, input: SkillInput) {
    return this.request<{ ok: true }>("PUT", `/admin/skills/${id}`, input);
  }

  deleteSkill(id: string) {
    return this.request<{ ok: true }>("DELETE", `/admin/skills/${id}`);
  }

  listProjects() {
    return this.request<{ projects: ProjectRow[] }>("GET", "/admin/projects");
  }

  createProject(input: ProjectInput) {
    return this.request<{ ok: true; id: string }>("POST", "/admin/projects", input);
  }

  updateProject(id: string, input: ProjectInput) {
    return this.request<{ ok: true }>("PUT", `/admin/projects/${id}`, input);
  }

  deleteProject(id: string) {
    return this.request<{ ok: true }>("DELETE", `/admin/projects/${id}`);
  }

  reorder(entity: "socials" | "skills" | "projects", ids: string[]) {
    return this.request<{ ok: true }>("PATCH", `/admin/${entity}/reorder`, { ids });
  }

  /* ---- media ---- */

  listMedia() {
    return this.request<{ media: MediaAsset[] }>("GET", "/admin/media");
  }

  /**
   * Multipart, so the JSON-only CSRF layer does not apply — the double-submit
   * token and the Origin allowlist still do. Reports upload progress (0–100)
   * because a 4 MB image over a slow link otherwise looks frozen.
   */
  uploadMedia(
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<ApiResult<{ ok: true; media: MediaAsset; deduped?: boolean }>> {
    const form = new FormData();
    form.append("file", file);

    return new Promise((resolve) => {
      this.http
        .post<{ ok: true; media: MediaAsset; deduped?: boolean }>(this.url("/admin/media"), form, {
          reportProgress: true,
          observe: "events",
        })
        .subscribe({
          next: (event) => {
            if (event.type === HttpEventType.UploadProgress && event.total) {
              onProgress?.(Math.round((event.loaded / event.total) * 100));
            } else if (event.type === HttpEventType.Response && event.body) {
              onProgress?.(100);
              resolve({ ok: true, data: event.body });
            }
          },
          error: (error: unknown) => {
            if (error instanceof HttpErrorResponse) {
              const code = (error.error as { error?: string } | null)?.error ?? "upload_failed";
              resolve({ ok: false, error: code, status: error.status });
              return;
            }
            resolve({ ok: false, error: "network_error", status: 0 });
          },
        });
    });
  }

  updateMediaAlt(id: string, alt: { altEn?: string | null; altDe?: string | null }) {
    return this.request<{ ok: true }>("PATCH", `/admin/media/${id}`, alt);
  }

  deleteMedia(id: string) {
    return this.request<{ ok: true }>("DELETE", `/admin/media/${id}`);
  }

  mediaReconcile() {
    return this.request<MediaReconcile>("GET", "/admin/media-reconcile");
  }
}

export interface MediaAsset {
  id: string;
  filename: string;
  originalName: string;
  mime: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  altEn: string | null;
  altDe: string | null;
  createdAt: string;
  /** Absolute, for previewing in the admin. */
  url: string;
  /** Relative `/media/<file>`; this is what a project stores. */
  path: string;
}

export interface MediaReconcile {
  missingFiles: string[];
  orphanFiles: string[];
  totalAssets: number;
  totalBytes: number;
}

/* -------------------------------------------------------------------------- */
/* Collection shapes — mirror the server's Zod inputs                          */
/* -------------------------------------------------------------------------- */

export interface ProfileInput {
  name: string;
  handle: string;
  contactEmail: string;
  primaryCtaHref: string;
  secondaryCtaHref: string;
}
export type ProfileRow = ProfileInput & { updatedAt: string };

export interface SocialInput {
  label: string;
  href: string;
  icon: "github" | "linkedin" | "mail" | "twitter";
  isVisible: boolean;
}
export type SocialRow = SocialInput & { id: string; position: number };

export interface SkillTranslation {
  title: string;
  caption: string;
  narrative: string;
}
export interface SkillInput {
  id: string;
  icon: "cpu" | "brain-circuit" | "container" | "database";
  span: "lg" | "tall" | "sm";
  items: string[];
  isVisible: boolean;
  translations: Record<Locale, SkillTranslation>;
}
export type SkillRow = SkillInput & { position: number };

export interface ProjectTranslation {
  name: string;
  descriptor: string;
  hook: string;
  problem: string;
  aiArchitecture: string;
  fullStackInfra: string;
  outcomes: string[];
}
export interface ProjectInput {
  slug: string;
  /** Set when the image came from the media library; null for a legacy path. */
  imageId: string | null;
  imagePath: string;
  stack: string[];
  linkLive: string;
  linkRepo: string;
  linkCaseStudy: string;
  isVisible: boolean;
  translations: Record<Locale, ProjectTranslation>;
}
export type ProjectRow = ProjectInput & { id: string; position: number };
