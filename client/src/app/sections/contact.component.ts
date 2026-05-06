import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  signal,
} from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { HlmField } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmLabel } from "@spartan-ng/helm/label";
import { HlmTextarea } from "@spartan-ng/helm/textarea";
import { z } from "zod";

import { MagneticButtonComponent } from "../components/magnetic-button.component";
import { ScrambleTextComponent } from "../components/scramble-text.component";
import { profile } from "../data/profile.data";
import { LanguageService } from "../services/language.service";
import { ContactService } from "../services/contact.service";

const contactSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.email().max(200),
  message: z.string().min(10).max(4000),
  website: z.string().max(0).optional(),
});

type SubmitState = "idle" | "submitting" | "success" | "error";

/** Spartan primitives + underlined "IDE" field styling. */
const fieldInputClass =
  "!h-auto !min-h-0 rounded-none !border-0 border-b border-border !bg-transparent px-0 py-2 !shadow-none ring-0 selection:bg-accent-indigo/25 focus-visible:!border-b-2 focus-visible:!border-accent-orange focus-visible:!pb-[7px] focus-visible:!ring-0 md:!text-base";

@Component({
  selector: "app-contact-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmField,
    HlmInput,
    HlmLabel,
    HlmTextarea,
    MagneticButtonComponent,
    ReactiveFormsModule,
    ScrambleTextComponent,
  ],
  host: {
    class: "block",
  },
  template: `
    <section
      id="contact"
      class="relative px-6 py-24 sm:px-8 sm:py-28 lg:px-12 lg:py-32"
    >
      <div class="mx-auto flex max-w-[600px] flex-col gap-10">
        <header class="flex flex-wrap items-baseline justify-between gap-4">
          <h2 class="m-0 font-mono text-2xl tracking-tight text-foreground sm:text-3xl">
            <app-scramble-text [text]="lang.t().contact.heading" />
          </h2>
          <p
            class="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground"
          >
            {{ lang.t().contact.subtitle }}
          </p>
        </header>

        @if (state() === 'success') {
          <div
            class="rounded-xl border border-border bg-card px-6 py-7 font-mono text-sm leading-relaxed shadow-[0_24px_60px_-30px_oklch(0_0_0/70%)]"
            role="status"
            aria-live="polite"
          >
            <p class="m-0 text-accent-orange">{{ lang.t().contact.successLine1 }}</p>
            <p class="m-0 mt-1 text-muted-foreground">
              {{ lang.t().contact.successLine2 }}
              <a
                class="text-foreground underline-offset-4 transition-colors duration-200 ease-in-out hover:text-accent-indigo hover:underline"
                [href]="'mailto:' + profile.contactEmail"
                >{{ profile.contactEmail }}</a
              >
            </p>
          </div>
        } @else {
          <form
            [formGroup]="form"
            (ngSubmit)="submit()"
            novalidate
            class="relative flex flex-col gap-6"
          >
            <div hlmField class="gap-1.5">
              <label
                hlmLabel
                for="contact-name"
                class="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground"
                >{{ lang.t().contact.labelName }}</label
              >
              <input
                hlmInput
                id="contact-name"
                type="text"
                autocomplete="name"
                formControlName="name"
                [placeholder]="lang.t().contact.placeholderName"
                [class]="fieldInputClass"
                [error]="showError('name') ? true : 'auto'"
                [attr.aria-invalid]="showError('name')"
              />
              @if (showError('name')) {
                <p class="m-0 font-mono text-[0.72rem] text-destructive">
                  {{ fieldError('name') }}
                </p>
              }
            </div>

            <div hlmField class="gap-1.5">
              <label
                hlmLabel
                for="contact-email"
                class="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground"
                >{{ lang.t().contact.labelEmail }}</label
              >
              <input
                hlmInput
                id="contact-email"
                type="email"
                autocomplete="email"
                formControlName="email"
                [placeholder]="lang.t().contact.placeholderEmail"
                [class]="fieldInputClass"
                [error]="showError('email') ? true : 'auto'"
                [attr.aria-invalid]="showError('email')"
              />
              @if (showError('email')) {
                <p class="m-0 font-mono text-[0.72rem] text-destructive">
                  {{ fieldError('email') }}
                </p>
              }
            </div>

            <div hlmField class="gap-1.5">
              <label
                hlmLabel
                for="contact-message"
                class="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground"
                >{{ lang.t().contact.labelMessage }}</label
              >
              <textarea
                hlmTextarea
                id="contact-message"
                rows="5"
                formControlName="message"
                [placeholder]="lang.t().contact.placeholderMessage"
                [class]="fieldInputClass + ' resize-y min-h-32 leading-relaxed'"
                [error]="showError('message') ? true : 'auto'"
                [attr.aria-invalid]="showError('message')"
              ></textarea>
              @if (showError('message')) {
                <p class="m-0 font-mono text-[0.72rem] text-destructive">
                  {{ fieldError('message') }}
                </p>
              }
            </div>

            <div
              aria-hidden="true"
              class="pointer-events-none absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
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

            @if (state() === 'error' && errorMsg()) {
              <p
                class="m-0 font-mono text-sm text-destructive"
                role="alert"
                aria-live="polite"
              >
                {{ errorMsg() }}
              </p>
            }

            <div class="flex items-center gap-3">
              <app-magnetic-button variant="primary" buttonType="submit">
                <span class="font-mono">{{ lang.t().contact.submit }}</span>
              </app-magnetic-button>
              @if (state() === 'submitting') {
                <span class="font-mono text-sm text-muted-foreground" aria-live="polite"
                  >{{ lang.t().contact.sending }}</span
                >
              }
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
  private readonly cdr = inject(ChangeDetectorRef);
  readonly lang = inject(LanguageService);

  readonly profile = profile;
  readonly fieldInputClass = fieldInputClass;
  readonly state = signal<SubmitState>("idle");
  readonly errorMsg = signal<string>("");

  readonly form = this.fb.nonNullable.group({
    name: ["", [Validators.required, Validators.maxLength(120)]],
    email: ["", [Validators.required, Validators.email, Validators.maxLength(200)]],
    message: [
      "",
      [Validators.required, Validators.minLength(10), Validators.maxLength(4000)],
    ],
    website: [""],
  });

  showError(name: "name" | "email" | "message"): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.dirty || c.touched);
  }

  fieldError(name: "name" | "email" | "message"): string {
    const c = this.form.controls[name];
    const e = c.errors;
    const t = this.lang.t().contact;
    if (!e) return "";
    if (e["required"]) return t.errorRequired;
    if (e["email"]) return t.errorEmail;
    if (e["minlength"]) return t.errorMinlength(e["minlength"].requiredLength);
    if (e["maxlength"]) return t.errorMaxlength(e["maxlength"].requiredLength);
    return t.errorInvalid;
  }

  async submit(): Promise<void> {
    if (this.state() === "submitting" || this.state() === "success") return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.state.set("error");
      this.errorMsg.set(this.lang.t().contact.errorFixFields);
      return;
    }
    const raw = this.form.getRawValue();
    const parsed = contactSchema.safeParse({
      name: raw.name.trim(),
      email: raw.email.trim(),
      message: raw.message.trim(),
      website: raw.website,
    });
    if (!parsed.success) {
      this.state.set("error");
      this.errorMsg.set(parsed.error.issues[0]?.message ?? this.lang.t().contact.errorInvalid);
      return;
    }

    this.state.set("submitting");
    this.errorMsg.set("");
    const result = await this.contact.send(parsed.data);
    if (result.ok) {
      this.state.set("success");
    } else {
      this.state.set("error");
      this.errorMsg.set(this.humanize(result.error));
    }
    this.cdr.markForCheck();
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
