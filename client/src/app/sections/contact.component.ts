import { DOCUMENT, isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideCircleAlert } from "@ng-icons/lucide";
import { z } from "zod";

import { SectionHeadingComponent } from "../components/section-heading.component";
import { AVAILABILITY_DOT, availabilityLabel } from "../content/availability";
import type { Locale } from "../content/locale";
import { placeName, timeZoneLabel } from "../content/place";
import { isWebLink } from "../content/social";
import { CHROME } from "../i18n/chrome";
import { fmt } from "../i18n/interpolate";
import { ClockService } from "../services/clock.service";
import { LanguageService } from "../services/language.service";
import { COPIED_MS, copyText, type CopyResult } from "../services/copy-text";
import { ContactService, type AskConversation } from "../services/contact.service";
import { TURNSTILE_SITE_KEY, turnstileToken } from "../services/turnstile";

/** The API's own limits; the form's validators say the same in the reader's language. */
const contactSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.email().max(200),
  message: z.string().min(10).max(4000),
});

type Field = "name" | "email" | "message";
type SubmitState = "idle" | "submitting" | "success" | "error";

const FIELDS: readonly Field[] = ["name", "email", "message"];

/**
 * The match page's way in (plan 3 W3). Here, not in `i18n/chrome.ts`: this
 * section's chunk loads on home only, the main bundle on every page.
 */
const MATCH_LINE: Record<Locale, { lead: string; link: string }> = {
  en: { lead: "Hiring, or have a project?", link: "Check the fit first" },
  de: { lead: "Sie stellen ein oder haben ein Projekt?", link: "Prüfen Sie zuerst, ob es passt" },
};

/**
 * The form as a WebMCP tool for the visitor's own agent (plan 3 W5): English, at most 500
 * characters. Never `toolautosubmit`: the agent fills, the human sends.
 */
const TOOL_DESCRIPTION =
  "Prepares a message to Alireza Rastineh through his portfolio's contact form: the sender's name, an email address for his reply, and the message (10 to 4,000 characters). The agent only fills the form; the user reviews it and clicks Send, which runs a bot check.";

/** Sentence case whatever the CMS sends ("name" reads "Name"). */
const labelClass = "block text-base font-medium text-foreground first-letter:uppercase";
const errorClass = "m-0 flex items-start gap-1.5 text-small text-destructive";

/**
 * The last section. From `md` the ways to reach him stand at the left (the statement, the email
 * to copy, the profiles, availability with the local time, how soon he replies, the match page)
 * and the form at the right; on phones they stack. The page's line ends at Send (motion.css):
 * from `md` the form spans two rows with Send alone in the second, so the run to it crosses no
 * text. After a send, "Message sent" takes the line's end and closes on the wordmark's dot.
 */
@Component({
  selector: "app-contact-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, ReactiveFormsModule, RouterLink, SectionHeadingComponent],
  viewProviders: [provideIcons({ lucideCircleAlert })],
  host: {
    class: "block",
  },
  template: `
    <section
      id="contact"
      aria-labelledby="contact-heading"
      class="container-site section-y relative"
    >
      <div class="flex flex-col gap-12">
        <app-section-heading headingId="contact-heading" [heading]="lang.t().contact.heading" />

        <!-- The one live region: progress and failures. Success moves focus
             to its message instead, which then reads itself. -->
        <p class="sr-only" role="status">{{ announcement() }}</p>

        <div class="grid grid-cols-12 gap-x-(--col-gap) gap-y-12 md:gap-y-6">
          <div class="col-span-12 flex flex-col gap-8 md:col-span-5 md:row-start-1">
            <div class="flex flex-col gap-3">
              <p class="m-0 text-balance text-title text-foreground">
                {{ lang.t().contact.subtitle }}
              </p>
              <!-- The button under the address: "Copied ✓" is wider than "Copy", and beside it
                   would jump a line. The address breaks after its @, never inside a word. -->
              <div class="flex flex-col items-start gap-2">
                <a
                  class="link-underline text-subtitle pointer-coarse:py-2.5"
                  [href]="'mailto:' + contactEmail()"
                  >{{ email().local }}<wbr />{{ email().domain }}</a
                >
                <!-- Its name starts with the visible word. -->
                <button type="button" class="control press" (click)="copyEmail()">
                  {{ copyLabels()[copied() ?? "copy"]
                  }}<span class="sr-only"> {{ chrome().copyWhat }}</span>
                </button>
                <!-- Not a second role=status: that one is the form's. -->
                <span class="sr-only" aria-live="polite">{{
                  copyLabels()[copied() ?? "idle"]
                }}</span>
              </div>
            </div>

            @if (socials().length) {
              <ul class="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0" role="list">
                @for (social of socials(); track social.href) {
                  <li>
                    <a
                      class="link-underline"
                      [href]="social.href"
                      [attr.target]="social.web ? '_blank' : null"
                      [attr.rel]="social.web ? 'noreferrer noopener' : null"
                      >{{ social.label
                      }}<span aria-hidden="true" [hidden]="!social.web"> ↗</span></a
                    >
                  </li>
                }
              </ul>
            }

            <div class="flex flex-col gap-2">
              <p class="m-0 flex flex-col gap-0.5">
                <span class="flex items-center gap-2 text-small font-medium text-foreground">
                  <span class="status-dot" [class]="dot()" aria-hidden="true"></span
                  >{{ availability() }}
                </span>
                <!-- The zone from the server; the time added in the browser, into space already
                     kept for it at the end of the line. -->
                <span class="pl-4 text-data text-faint-foreground"
                  >{{ where() }}
                  @if (zone()) {
                    <span class="sr-only">{{ chrome().localTime }}</span>
                    <time class="inline-block min-w-[5ch] tabular-nums">{{ time() }}</time>
                  }
                </span>
              </p>
              @if (replyTime()) {
                <p class="m-0 text-small text-muted-foreground">{{ replyTime() }}</p>
              }
            </div>

            <p class="m-0 text-small text-muted-foreground">
              {{ matchLine().lead }}
              <a class="link-underline" [routerLink]="['/', lang.lang(), 'match']">{{
                matchLine().link
              }}</a>
            </p>
          </div>

          @if (state() === "success") {
            <div
              #success
              tabindex="-1"
              class="col-span-12 flex flex-col items-start gap-3 md:col-span-7 md:row-start-1"
            >
              <!-- The line ends here after a send, and the words close on its dot. -->
              <p class="page-line-end m-0 text-title text-foreground">
                {{ sent() }}<span class="sent-dot text-signal" aria-hidden="true">.</span>
              </p>
              <p class="m-0 text-muted-foreground">
                {{ lang.t().contact.successLine2 }}
                <a class="link-underline" [href]="'mailto:' + contactEmail()">{{
                  contactEmail()
                }}</a>
              </p>
              <button type="button" class="btn-quiet press" (click)="reset()">
                {{ chrome().sendAnother }}
              </button>
            </div>
          } @else {
            <form
              [formGroup]="form"
              (ngSubmit)="submit()"
              novalidate
              class="col-span-12 flex flex-col gap-6 md:col-span-7 md:row-span-2 md:grid md:grid-rows-subgrid"
              [attr.aria-busy]="state() === 'submitting' ? 'true' : null"
              [attr.data-ready]="ready() ? '' : null"
              [attr.toolname]="ready() ? 'contact_alireza' : null"
              [attr.tooldescription]="ready() ? toolDescription : null"
            >
              <div class="flex flex-col gap-6">
                <div class="flex flex-col gap-2">
                  <label for="contact-name" [class]="labelClass">{{
                    lang.t().contact.labelName
                  }}</label>
                  <div class="field-line">
                    <input
                      #field
                      id="contact-name"
                      type="text"
                      autocomplete="name"
                      enterkeyhint="next"
                      required
                      maxlength="120"
                      formControlName="name"
                      [attr.name]="ready() ? 'name' : null"
                      [placeholder]="lang.t().contact.placeholderName"
                      class="field"
                      [attr.aria-invalid]="showError('name') ? 'true' : null"
                      [attr.aria-describedby]="showError('name') ? 'contact-name-error' : null"
                    />
                  </div>
                  @if (showError("name")) {
                    <p id="contact-name-error" [class]="errorClass">
                      <ng-icon
                        class="mt-0.75 shrink-0"
                        name="lucideCircleAlert"
                        size="16"
                        aria-hidden="true"
                      />{{ fieldError("name") }}
                    </p>
                  }
                </div>

                <div class="flex flex-col gap-2">
                  <label for="contact-email" [class]="labelClass">{{
                    lang.t().contact.labelEmail
                  }}</label>
                  <div class="field-line">
                    <input
                      #field
                      id="contact-email"
                      type="email"
                      autocomplete="email"
                      enterkeyhint="next"
                      spellcheck="false"
                      required
                      maxlength="200"
                      formControlName="email"
                      [attr.name]="ready() ? 'email' : null"
                      [placeholder]="lang.t().contact.placeholderEmail"
                      class="field"
                      [attr.aria-invalid]="showError('email') ? 'true' : null"
                      [attr.aria-describedby]="showError('email') ? 'contact-email-error' : null"
                    />
                  </div>
                  @if (showError("email")) {
                    <p id="contact-email-error" [class]="errorClass">
                      <ng-icon
                        class="mt-0.75 shrink-0"
                        name="lucideCircleAlert"
                        size="16"
                        aria-hidden="true"
                      />{{ fieldError("email") }}
                    </p>
                  }
                </div>

                <div class="flex flex-col gap-2">
                  <label for="contact-message" [class]="labelClass">{{
                    lang.t().contact.labelMessage
                  }}</label>
                  <div class="field-line">
                    <textarea
                      #field
                      id="contact-message"
                      rows="5"
                      autocomplete="off"
                      required
                      maxlength="4000"
                      formControlName="message"
                      [attr.name]="ready() ? 'message' : null"
                      [placeholder]="lang.t().contact.placeholderMessage"
                      class="field min-h-32 resize-y leading-relaxed"
                      [attr.aria-invalid]="showError('message') ? 'true' : null"
                      [attr.aria-describedby]="
                        showError('message') ? 'contact-message-error' : null
                      "
                    ></textarea>
                  </div>
                  @if (showError("message")) {
                    <p id="contact-message-error" [class]="errorClass">
                      <ng-icon
                        class="mt-0.75 shrink-0"
                        name="lucideCircleAlert"
                        size="16"
                        aria-hidden="true"
                      />{{ fieldError("message") }}
                    </p>
                  }
                </div>

                @if (attachable()) {
                  <!-- After the assistant's hand-off: the conversation goes only if ticked. -->
                  <div class="flex items-start gap-2 text-small">
                    <input
                      id="contact-attach"
                      type="checkbox"
                      class="mt-1 size-4 accent-current pointer-coarse:mt-3.5"
                      [checked]="attach()"
                      (change)="attach.set($any($event.target).checked)"
                      aria-describedby="contact-attach-hint"
                    />
                    <div class="flex flex-col gap-0.5">
                      <label
                        for="contact-attach"
                        class="pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                        >{{ chrome().attach }}</label
                      >
                      <p id="contact-attach-hint" class="m-0 text-muted-foreground">
                        {{ chrome().attachHint }}
                      </p>
                    </div>
                  </div>
                }

                <!-- Honeypot: invisible to people, tempting to bots. -->
                <div
                  aria-hidden="true"
                  class="pointer-events-none absolute left-[-9999px] top-auto size-px overflow-hidden"
                >
                  <label for="contact-website">website</label>
                  <input
                    id="contact-website"
                    type="text"
                    tabindex="-1"
                    autocomplete="off"
                    formControlName="website"
                  />
                </div>

                @if (state() === "error" && errorMsg()) {
                  <p [class]="errorClass">
                    <ng-icon
                      class="mt-0.75 shrink-0"
                      name="lucideCircleAlert"
                      size="16"
                      aria-hidden="true"
                    />{{ errorMsg() }}
                  </p>
                }
              </div>

              <!-- The page's line ends at Send: a run from the spine to the button (motion.css). -->
              <div class="flex items-center">
                <span class="page-line-run" aria-hidden="true"></span>
                <button
                  type="submit"
                  class="page-line-end btn btn-solid press"
                  [disabled]="state() === 'submitting'"
                  [attr.aria-busy]="state() === 'submitting' ? 'true' : null"
                >
                  {{
                    state() === "submitting" ? lang.t().contact.sending : lang.t().contact.submit
                  }}
                </button>
              </div>
            </form>
          }
        </div>
      </div>
    </section>
  `,
})
export class ContactSectionComponent {
  private readonly fb = inject(FormBuilder);
  private readonly contact = inject(ContactService);
  private readonly injector = inject(Injector);
  private readonly doc = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly lang = inject(LanguageService);

  /**
   * True once this form's code runs in the browser. The home page hydrates it
   * when the browser is idle, so for a moment the server's markup is on screen
   * without it; `data-ready` on the form marks the difference (tests wait on
   * it). The fields' names and the form's tool name wait for it too: with no
   * `action`, a submit before then is a GET, and named fields would put the
   * message in the URL (Caddy's logs, Umami).
   */
  protected readonly ready = signal(false);

  protected readonly labelClass = labelClass;
  protected readonly errorClass = errorClass;
  protected readonly toolDescription = TOOL_DESCRIPTION;
  protected readonly chrome = computed(() => CHROME[this.lang.lang()].contact);
  protected readonly copyLabels = computed(() => CHROME[this.lang.lang()].code);
  protected readonly matchLine = computed(() => MATCH_LINE[this.lang.lang()]);

  readonly contactEmail = computed(() => this.lang.content().identity.contactEmail);
  /** The address up to its @, and the rest: it may break there and nowhere else. */
  protected readonly email = computed(() => {
    const email = this.contactEmail();
    const at = email.lastIndexOf("@") + 1;
    return { local: email.slice(0, at), domain: email.slice(at) };
  });

  /** "Message sent", its own full stop left to the dot. */
  protected readonly sent = computed(() =>
    this.lang.t().contact.successLine1.trim().replace(/\.$/, ""),
  );

  /** True for a moment after the email address was copied. */
  protected readonly copied = signal<CopyResult | null>(null);
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;

  /** Profiles by name; the email is shown on its own above them. */
  protected readonly socials = computed(() =>
    this.lang
      .content()
      .socials.filter((s) => !s.href.startsWith("mailto:"))
      .map((s) => ({ ...s, web: isWebLink(s.href) })),
  );

  private readonly identity = computed(() => this.lang.content().identity);
  protected readonly dot = computed(() => AVAILABILITY_DOT[this.identity().availability]);
  protected readonly availability = computed(() =>
    availabilityLabel(this.lang.t().hero, this.identity().availability),
  );
  protected readonly zone = computed(() =>
    timeZoneLabel(this.identity().timezone, this.lang.lang()),
  );
  /** As the hero's status says it: the place, else the CMS's "Remote", then the zone. */
  protected readonly where = computed(() =>
    [
      placeName(this.identity().location, this.lang.lang()) || this.lang.t().profile.location,
      this.zone(),
    ]
      .filter(Boolean)
      .join(", "),
  );
  private readonly clock = inject(ClockService);
  protected readonly time = computed(() => this.clock.time(this.identity().timezone));
  protected readonly replyTime = computed(() => this.lang.t().contact.replyTime?.trim() ?? "");
  readonly state = signal<SubmitState>("idle");
  readonly errorMsg = signal<string>("");

  /** The conversation the assistant's hand-off came from, while the form holds its draft. */
  protected readonly attachable = signal<AskConversation | null>(null);
  /** The visitor's opt-in to attach it: off unless ticked. */
  protected readonly attach = signal(false);
  /** Whether the visitor has tried to send: from then on every invalid field shows its error. */
  private readonly attempted = signal(false);

  protected readonly announcement = computed(() => {
    const state = this.state();
    if (state === "submitting") return this.lang.t().contact.sending;
    if (state === "error") return this.errorMsg();
    return "";
  });

  private readonly firstInput = viewChild<ElementRef<HTMLElement>>("field");
  private readonly successMessage = viewChild<ElementRef<HTMLElement>>("success");

  readonly form = this.fb.nonNullable.group({
    name: [this.typed("name"), [Validators.required, Validators.maxLength(120)]],
    email: [
      this.typed("email"),
      [Validators.required, Validators.email, Validators.maxLength(200)],
    ],
    message: [
      this.typed("message"),
      [Validators.required, Validators.minLength(10), Validators.maxLength(4000)],
    ],
    website: [this.typed("website")],
  });

  constructor() {
    afterNextRender(() => {
      this.ready.set(this.isBrowser);
      this.clock.start();
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.copiedTimer));

    // The assistant's hand-off (after the visitor confirmed it): the summary
    // becomes the message, and the visitor adds their name and email. The
    // conversation it came from can be attached, unticked until they tick it.
    effect(() => {
      const prefill = this.contact.prefill();
      if (!prefill || !this.isBrowser) return;
      untracked(() => {
        this.contact.prefill.set(null);
        if (this.state() === "success") this.reset();
        this.form.controls.message.setValue(prefill.text.slice(0, 4000));
        this.form.controls.message.markAsDirty();
        this.attachable.set(prefill.ask);
        this.attach.set(false);
        afterNextRender(() => this.firstField()?.focus(), { injector: this.injector });
      });
    });
  }

  /**
   * What is already in the server-rendered field. Someone who started typing
   * before the form's code arrived keeps their text: the form would otherwise
   * write its own empty value over it as it takes the field over.
   */
  private typed(field: Field | "website"): string {
    if (!this.isBrowser) return "";
    const el = this.doc.getElementById(`contact-${field}`);
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : "";
  }

  protected async copyEmail(): Promise<void> {
    this.copied.set(await copyText(this.contactEmail()));
    clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => this.copied.set(null), COPIED_MS);
  }

  /**
   * Once a field has been typed in, or after a try to send; never on leaving
   * an untouched field. An error appearing on that blur moved everything below
   * the field while the pointer was down on the next control: after the
   * assistant's hand-off, which focuses the empty name, the first click on the
   * attach box missed it.
   */
  showError(name: Field): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.dirty || this.attempted());
  }

  fieldError(name: Field): string {
    const e = this.form.controls[name].errors;
    const t = this.lang.t().contact;
    if (!e) return "";
    if (e["required"]) return t.errorRequired;
    if (e["email"]) return t.errorEmail;
    if (e["minlength"]) return fmt(t.errorMinlength, { n: e["minlength"].requiredLength });
    if (e["maxlength"]) return fmt(t.errorMaxlength, { n: e["maxlength"].requiredLength });
    return t.errorInvalid;
  }

  private validateForm(): z.infer<typeof contactSchema> | null {
    const raw = this.form.getRawValue();
    this.form.markAllAsTouched();
    this.attempted.set(true);
    const parsed = contactSchema.safeParse({
      name: raw.name.trim(),
      email: raw.email.trim(),
      message: raw.message.trim(),
    });
    // The schema is stricter than Angular's validators in places (email
    // format, whitespace-only text): mark those fields so their own
    // localized message shows.
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        const control = this.form.controls[field];
        if (control.valid) {
          control.setErrors({ [field === "email" ? "email" : "required"]: true });
        }
      }
    }
    if (this.form.invalid || !parsed.success) {
      this.fail(this.lang.t().contact.errorFixFields);
      this.focusFirstInvalid();
      return null;
    }
    return parsed.data;
  }

  private async fetchTurnstile(): Promise<string | null> {
    if (!TURNSTILE_SITE_KEY) return "";
    try {
      return await turnstileToken(this.lang.lang());
    } catch {
      this.fail(this.humanize("turnstile_failed"));
      return null;
    }
  }

  async submit(): Promise<void> {
    if (this.state() === "submitting" || this.state() === "success") return;
    const raw = this.form.getRawValue();

    // A bot filled the honeypot: look sent, send nothing.
    if (raw.website) {
      this.succeed();
      return;
    }

    const data = this.validateForm();
    if (!data) return;

    this.state.set("submitting");
    this.errorMsg.set("");

    const turnstile = await this.fetchTurnstile();
    if (turnstile === null) return;

    // The page language, so the inbox shows which language to reply in. A
    // hand-off says so; its conversation goes only with the visitor's tick.
    const ask = this.attachable();
    const result = await this.contact.send({
      ...data,
      locale: this.lang.lang(),
      ...(turnstile ? { turnstileToken: turnstile } : {}),
      ...(ask ? { origin: "ask" as const } : {}),
      ...(ask && this.attach() ? { ask } : {}),
    });
    if (result.ok) this.succeed();
    else this.fail(this.humanize(result.error));
  }

  reset(): void {
    // Explicitly empty: a plain reset() returns to the initial values, which
    // may be what was typed before the form's code arrived.
    this.form.reset({ name: "", email: "", message: "", website: "" });
    this.attempted.set(false);
    this.state.set("idle");
    this.errorMsg.set("");
    this.forgetConversation();
    afterNextRender(() => this.firstField()?.focus(), { injector: this.injector });
  }

  /** A sent or discarded hand-off: the next message is the visitor's own. */
  private forgetConversation(): void {
    this.attachable.set(null);
    this.attach.set(false);
  }

  private succeed(): void {
    this.forgetConversation();
    this.state.set("success");
    afterNextRender(() => this.successMessage()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  private fail(message: string): void {
    this.state.set("error");
    this.errorMsg.set(message);
  }

  private focusFirstInvalid(): void {
    const first = FIELDS.find((name) => this.form.controls[name].invalid);
    if (first) document.getElementById(`contact-${first}`)?.focus();
  }

  private firstField(): HTMLElement | null {
    return this.firstInput()?.nativeElement ?? null;
  }

  private humanize(code: string): string {
    const t = this.lang.t().contact;
    switch (code) {
      case "rate_limited":
        return t.errorRateLimited;
      case "invalid_input":
        return t.errorInvalidInput;
      case "mailer_unavailable":
        return t.errorMailerUnavailable;
      case "send_failed":
      case "turnstile_failed":
        return t.errorSendFailed;
      default:
        return t.errorNetwork;
    }
  }
}
