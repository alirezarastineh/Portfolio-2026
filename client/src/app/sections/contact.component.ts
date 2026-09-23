import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { z } from "zod";

import { MagneticButtonComponent } from "../components/magnetic-button.component";
import { SectionHeadingComponent } from "../components/section-heading.component";
import { CHROME } from "../i18n/chrome";
import { fmt } from "../i18n/interpolate";
import { LanguageService } from "../services/language.service";
import { ContactService } from "../services/contact.service";

/** The API's own limits; the form's validators say the same in the reader's language. */
const contactSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.email().max(200),
  message: z.string().min(10).max(4000),
});

type Field = "name" | "email" | "message";
type SubmitState = "idle" | "submitting" | "success" | "error";

const FIELDS: readonly Field[] = ["name", "email", "message"];

/** An underlined "IDE" field. Focus thickens the line (a shadow, so nothing moves). */
const fieldClass =
  "block w-full border-0 border-b border-border bg-transparent px-0 py-2 text-base text-foreground transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground selection:bg-accent-indigo/25 focus:border-accent-orange focus:shadow-[0_1px_0_0_var(--accent-orange)] focus-visible:outline-none aria-[invalid=true]:border-destructive";
const labelClass = "font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground";
const errorClass = "m-0 font-mono text-[0.72rem] text-destructive";

@Component({
  selector: "app-contact-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MagneticButtonComponent, ReactiveFormsModule, SectionHeadingComponent],
  host: {
    class: "block",
  },
  template: `
    <section
      id="contact"
      aria-labelledby="contact-heading"
      class="relative px-6 py-24 sm:px-8 sm:py-28 lg:px-12 lg:py-32"
    >
      <div class="mx-auto flex max-w-150 flex-col gap-12">
        <app-section-heading
          headingId="contact-heading"
          [heading]="lang.t().contact.heading"
          [eyebrow]="lang.t().contact.subtitle"
        />

        <!-- The one live region: progress and failures. Success moves focus
             to its message instead, which then reads itself. -->
        <p class="sr-only" role="status">{{ announcement() }}</p>

        @if (state() === "success") {
          <div
            #success
            tabindex="-1"
            class="flex flex-col gap-4 rounded-xl border border-border bg-card px-6 py-7 font-mono text-sm leading-relaxed shadow-elevated"
          >
            <div>
              <p class="m-0 text-accent-orange">{{ lang.t().contact.successLine1 }}</p>
              <p class="m-0 mt-1 text-muted-foreground">
                {{ lang.t().contact.successLine2 }}
                <a
                  class="text-foreground underline decoration-accent-orange/60 underline-offset-4 transition-colors hover:decoration-accent-orange"
                  [href]="'mailto:' + contactEmail()"
                  >{{ contactEmail() }}</a
                >
              </p>
            </div>
            <button
              type="button"
              class="w-fit cursor-pointer text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent-orange"
              (click)="reset()"
            >
              {{ chrome().sendAnother }}
            </button>
          </div>
        } @else {
          <form
            [formGroup]="form"
            (ngSubmit)="submit()"
            novalidate
            class="relative flex flex-col gap-6"
            [attr.aria-busy]="state() === 'submitting' ? 'true' : null"
          >
            <div class="flex flex-col gap-1.5">
              <label for="contact-name" [class]="labelClass">{{
                lang.t().contact.labelName
              }}</label>
              <input
                #field
                id="contact-name"
                type="text"
                autocomplete="name"
                required
                maxlength="120"
                formControlName="name"
                [placeholder]="lang.t().contact.placeholderName"
                [class]="fieldClass"
                [attr.aria-invalid]="showError('name') ? 'true' : null"
                [attr.aria-describedby]="showError('name') ? 'contact-name-error' : null"
              />
              @if (showError("name")) {
                <p id="contact-name-error" [class]="errorClass">{{ fieldError("name") }}</p>
              }
            </div>

            <div class="flex flex-col gap-1.5">
              <label for="contact-email" [class]="labelClass">{{
                lang.t().contact.labelEmail
              }}</label>
              <input
                #field
                id="contact-email"
                type="email"
                autocomplete="email"
                required
                maxlength="200"
                formControlName="email"
                [placeholder]="lang.t().contact.placeholderEmail"
                [class]="fieldClass"
                [attr.aria-invalid]="showError('email') ? 'true' : null"
                [attr.aria-describedby]="showError('email') ? 'contact-email-error' : null"
              />
              @if (showError("email")) {
                <p id="contact-email-error" [class]="errorClass">{{ fieldError("email") }}</p>
              }
            </div>

            <div class="flex flex-col gap-1.5">
              <label for="contact-message" [class]="labelClass">{{
                lang.t().contact.labelMessage
              }}</label>
              <textarea
                #field
                id="contact-message"
                rows="5"
                required
                maxlength="4000"
                formControlName="message"
                [placeholder]="lang.t().contact.placeholderMessage"
                [class]="fieldClass + ' min-h-32 resize-y leading-relaxed'"
                [attr.aria-invalid]="showError('message') ? 'true' : null"
                [attr.aria-describedby]="showError('message') ? 'contact-message-error' : null"
              ></textarea>
              @if (showError("message")) {
                <p id="contact-message-error" [class]="errorClass">
                  {{ fieldError("message") }}
                </p>
              }
            </div>

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
              <p class="m-0 font-mono text-sm text-destructive">{{ errorMsg() }}</p>
            }

            <div class="flex items-center gap-3">
              <app-magnetic-button
                variant="primary"
                buttonType="submit"
                [disabled]="state() === 'submitting'"
                [busy]="state() === 'submitting'"
              >
                {{ state() === "submitting" ? lang.t().contact.sending : lang.t().contact.submit }}
              </app-magnetic-button>
            </div>
          </form>
        }
      </div>
    </section>
  `,
})
export class ContactSectionComponent {
  private readonly fb = inject(FormBuilder);
  private readonly contact = inject(ContactService);
  private readonly injector = inject(Injector);
  readonly lang = inject(LanguageService);

  protected readonly fieldClass = fieldClass;
  protected readonly labelClass = labelClass;
  protected readonly errorClass = errorClass;
  protected readonly chrome = computed(() => CHROME[this.lang.lang()].contact);

  readonly contactEmail = computed(() => this.lang.content().identity.contactEmail);
  readonly state = signal<SubmitState>("idle");
  readonly errorMsg = signal<string>("");

  protected readonly announcement = computed(() => {
    const state = this.state();
    if (state === "submitting") return this.lang.t().contact.sending;
    if (state === "error") return this.errorMsg();
    return "";
  });

  private readonly firstInput = viewChild<ElementRef<HTMLElement>>("field");
  private readonly successMessage = viewChild<ElementRef<HTMLElement>>("success");

  readonly form = this.fb.nonNullable.group({
    name: ["", [Validators.required, Validators.maxLength(120)]],
    email: ["", [Validators.required, Validators.email, Validators.maxLength(200)]],
    message: ["", [Validators.required, Validators.minLength(10), Validators.maxLength(4000)]],
    website: [""],
  });

  showError(name: Field): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.dirty || c.touched);
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

  async submit(): Promise<void> {
    if (this.state() === "submitting" || this.state() === "success") return;
    const raw = this.form.getRawValue();

    // A bot filled the honeypot: look sent, send nothing.
    if (raw.website) {
      this.succeed();
      return;
    }

    this.form.markAllAsTouched();
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
        if (control.valid) control.setErrors({ [field === "email" ? "email" : "required"]: true });
      }
    }
    if (this.form.invalid || !parsed.success) {
      this.fail(this.lang.t().contact.errorFixFields);
      this.focusFirstInvalid();
      return;
    }

    this.state.set("submitting");
    this.errorMsg.set("");
    // The page language, so the inbox shows which language to reply in.
    const result = await this.contact.send({ ...parsed.data, locale: this.lang.lang() });
    if (result.ok) this.succeed();
    else this.fail(this.humanize(result.error));
  }

  reset(): void {
    this.form.reset();
    this.state.set("idle");
    this.errorMsg.set("");
    afterNextRender(() => this.firstField()?.focus(), { injector: this.injector });
  }

  private succeed(): void {
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
        return t.errorSendFailed;
      default:
        return t.errorNetwork;
    }
  }
}
