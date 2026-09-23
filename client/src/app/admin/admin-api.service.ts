import { HttpClient, HttpErrorResponse, HttpEventType } from "@angular/common/http";
import { inject, Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

import type { AppContent, Locale } from "../content/schema";
import type {
  ExperienceInput,
  PostInput,
  ProfileInput,
  ProjectInput,
  ProjectTranslationInput,
  SkillInput,
  SocialInput,
} from "./admin-schema";

export type {
  ExperienceInput,
  ExperienceTranslationInput,
  GalleryItemInput,
  LegalSectionInput,
  MetricInput,
  PostInput,
  PostStatus,
  PostTranslationInput,
  ProfileInput,
  ProjectInput,
  ProjectTranslationInput,
  SkillInput,
  SkillTranslationInput,
  SocialInput,
} from "./admin-schema";

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
  /** The publish (or rollback) this version belongs to, with the other locale's version. */
  publicationId: number | null;
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
/**
 * Provided by the admin route (`pages/admin.page.ts`), not the root: it must
 * use the admin's HttpClient, whose interceptor adds credentials and CSRF.
 */
@Injectable()
export class AdminApiService {
  private readonly http = inject(HttpClient);

  readonly baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/$/, "");

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
    return this.request<{
      ok: true;
      /** True when the draft already matched what is live, so nothing was written. */
      unchanged: boolean;
      publicationId: number | null;
      published: { locale: Locale; versionId: number }[];
    }>("POST", "/admin/publish", label ? { label } : {});
  }

  revisions() {
    return this.request<{ revisions: RevisionRow[] }>("GET", "/admin/revisions");
  }

  revision(id: number) {
    return this.request<RevisionDetail>("GET", `/admin/revisions/${id}`);
  }

  /** Rolls back the whole publication `id` belongs to — every locale moves together. */
  rollback(id: number) {
    return this.request<{
      ok: true;
      locale: Locale;
      versionId: number;
      publicationId: number;
      rolledBack: { locale: Locale; versionId: number }[];
    }>("POST", `/admin/revisions/${id}/rollback`, {});
  }

  publications() {
    return this.request<{ publications: PublicationRow[] }>("GET", "/admin/publications");
  }

  /** Every locale of the publication goes live again, as a new publication. */
  rollbackPublication(publicationId: number) {
    return this.request<{
      ok: true;
      publicationId: number;
      restoredFrom: number;
      results: { locale: Locale; versionId: number }[];
    }>("POST", `/admin/publications/${publicationId}/rollback`, {});
  }

  /** Makes the draft match a publication again; nothing goes live until the next publish. */
  restoreDraft(publicationId: number) {
    return this.request<{ ok: true; restored: Locale[] }>(
      "POST",
      `/admin/publications/${publicationId}/restore-draft`,
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

  /** Light rows: names per locale, no bodies. */
  listProjects() {
    return this.request<{ projects: ProjectListRow[] }>("GET", "/admin/projects");
  }

  getProject(id: string) {
    return this.request<{ project: ProjectRow }>("GET", `/admin/projects/${id}`);
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

  setVisibility(entity: "projects" | "experiences", id: string, isVisible: boolean) {
    return this.request<{ ok: true }>("PATCH", `/admin/${entity}/${id}/visibility`, { isVisible });
  }

  reorder(entity: "socials" | "skills" | "projects" | "experiences", ids: string[]) {
    return this.request<{ ok: true }>("PATCH", `/admin/${entity}/reorder`, { ids });
  }

  /* ---- experience ---- */

  listExperiences() {
    return this.request<{ experiences: ExperienceRow[] }>("GET", "/admin/experiences");
  }

  createExperience(input: ExperienceInput) {
    return this.request<{ ok: true; id: string }>("POST", "/admin/experiences", input);
  }

  updateExperience(id: string, input: ExperienceInput) {
    return this.request<{ ok: true }>("PUT", `/admin/experiences/${id}`, input);
  }

  deleteExperience(id: string) {
    return this.request<{ ok: true }>("DELETE", `/admin/experiences/${id}`);
  }

  /* ---- writing ---- */

  listPosts() {
    return this.request<{ posts: PostListRow[] }>("GET", "/admin/posts");
  }

  getPost(id: string) {
    return this.request<{ post: PostRow }>("GET", `/admin/posts/${id}`);
  }

  createPost(input: PostInput) {
    return this.request<{ ok: true; id: string }>("POST", "/admin/posts", input);
  }

  updatePost(id: string, input: PostInput) {
    return this.request<{ ok: true }>("PUT", `/admin/posts/${id}`, input);
  }

  deletePost(id: string) {
    return this.request<{ ok: true }>("DELETE", `/admin/posts/${id}`);
  }

  /* ---- CVs ---- */

  getResumes() {
    return this.request<{ resumes: Record<Locale, ResumeRow | null> }>("GET", "/admin/resumes");
  }

  putResume(locale: Locale, mediaId: string) {
    return this.request<{ ok: true }>("PUT", `/admin/resumes/${locale}`, { mediaId });
  }

  deleteResume(locale: Locale) {
    return this.request<{ ok: true }>("DELETE", `/admin/resumes/${locale}`);
  }

  /* ---- contact inbox ---- */

  listMessages(status?: MessageStatus) {
    const query = status ? `?status=${status}` : "";
    return this.request<{ messages: MessageRow[] }>("GET", `/admin/messages${query}`);
  }

  setMessageStatus(id: string, status: MessageStatus) {
    return this.request<{ ok: true }>("PATCH", `/admin/messages/${id}`, { status });
  }

  /* ---- media ---- */

  listMedia() {
    return this.request<{ media: MediaAsset[] }>("GET", "/admin/media");
  }

  /**
   * Multipart, so the JSON-only CSRF layer does not apply — the double-submit
   * token and the Origin allowlist still do. Reports upload progress (0–100)
   * because a 10 MB photo over a slow link otherwise looks frozen.
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

  /**
   * `confirm` overrides the one refusal that is a warning rather than a block:
   * the asset appears only in recent publications (`media_in_history`).
   */
  deleteMedia(id: string, confirm = false) {
    return this.request<{ ok: true }>("DELETE", `/admin/media/${id}${confirm ? "?confirm=1" : ""}`);
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
  /** `document` is a PDF (the CV); only images can go on a project. */
  kind: "image" | "document";
  byteSize: number;
  width: number | null;
  height: number | null;
  /** Tiny blurred WebP data URI; null for GIFs, PDFs and not-yet-reprocessed images. */
  blurDataUri: string | null;
  altEn: string | null;
  altDe: string | null;
  createdAt: string;
  /** Absolute, for previewing in the admin. */
  url: string;
  /** Relative `/media/<file>`; this is what a project stores. */
  path: string;
  /** Resized copies, smallest first per format; empty for GIFs, PDFs and small images. */
  variants: { format: "webp" | "avif"; width: number; height: number; path: string }[];
}

export interface MediaReconcile {
  missingFiles: string[];
  orphanFiles: string[];
  totalAssets: number;
  totalBytes: number;
}

/* -------------------------------------------------------------------------- */
/* Rows the API returns. Inputs are the mirrored Zod schemas (admin-schema.ts), */
/* so the editors are typed against exactly what the server validates.         */
/* -------------------------------------------------------------------------- */

export type ProfileRow = ProfileInput & { avatarPath: string | null; updatedAt: string };

export type SocialRow = SocialInput & { id: string; position: number };

export type SkillTranslation = SkillInput["translations"]["en"];
export type SkillRow = SkillInput & { position: number };

export type ProjectTranslation = ProjectTranslationInput;

/** A project as the editor loads it: the input shape plus ids and previews. */
export type ProjectRow = Omit<ProjectInput, "gallery"> & {
  id: string;
  position: number;
  /** `/media/<file>` of the cover, for the preview. */
  coverPath: string | null;
  gallery: (ProjectInput["gallery"][number] & { path: string })[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectListRow = Omit<ProjectRow, "gallery" | "translations"> & {
  translations: Partial<Record<Locale, { name: string; hasCaseStudy: boolean }>>;
};

export type ExperienceRow = ExperienceInput & {
  id: string;
  position: number;
  logoPath: string | null;
  updatedAt: string;
};

export type PostRow = PostInput & {
  id: string;
  coverPath: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PostListRow = Omit<PostRow, "translations"> & {
  translations: Partial<Record<Locale, { title: string }>>;
};

export interface ResumeRow {
  mediaId: string;
  path: string;
  originalName: string;
  byteSize: number;
  updatedAt: string;
}

export interface PublicationRow {
  id: number;
  kind: "publish" | "rollback";
  label: string | null;
  schemaVersion: number;
  restoredFrom: number | null;
  createdAt: string;
  versions: { id: number; locale: Locale; live: boolean }[];
  live: boolean;
}

export type MessageStatus = "new" | "read" | "archived" | "spam";

export interface MessageRow {
  id: string;
  createdAt: string;
  locale: Locale | null;
  name: string;
  email: string;
  message: string;
  status: MessageStatus;
  mailStatus: "pending" | "sent" | "failed" | "skipped";
  mailError: string | null;
}

/** Re-exported for pages that type a single translation. */
export type {
  ExperienceTranslationInput as ExperienceTranslation,
  PostTranslationInput as PostTranslation,
  PostStatus as PostState,
} from "./admin-schema";
