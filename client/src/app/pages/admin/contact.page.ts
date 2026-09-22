import { ChangeDetectionStrategy, Component } from "@angular/core";
import type { RouteMeta } from "@analogjs/router";

import { unsavedChangesGuard } from "../../admin/unsaved-changes.service";

import {
  UiGroupEditorComponent,
  type UiFieldDef,
} from "../../admin/components/ui-group-editor.component";

const FIELDS: UiFieldDef[] = [
  { key: "heading", label: "Section heading" },
  { key: "subtitle", label: "Section subtitle" },
  { key: "labelName", label: "Label — name" },
  { key: "labelEmail", label: "Label — email" },
  { key: "labelMessage", label: "Label — message" },
  { key: "placeholderName", label: "Placeholder — name" },
  { key: "placeholderEmail", label: "Placeholder — email" },
  { key: "placeholderMessage", label: "Placeholder — message", multiline: true, rows: 2 },
  { key: "submit", label: "Submit button" },
  { key: "sending", label: "Submit button while sending" },
  { key: "successLine1", label: "Success — line 1" },
  { key: "successLine2", label: "Success — line 2" },
  { key: "errorRequired", label: "Error — required" },
  { key: "errorEmail", label: "Error — invalid email" },
  {
    key: "errorMinlength",
    label: "Error — too short",
    hint: "Must contain {n}, which is replaced by the minimum length.",
  },
  {
    key: "errorMaxlength",
    label: "Error — too long",
    hint: "Must contain {n}, which is replaced by the maximum length.",
  },
  { key: "errorInvalid", label: "Error — generic invalid" },
  { key: "errorFixFields", label: "Error — fix highlighted fields" },
  { key: "errorRateLimited", label: "Error — rate limited" },
  { key: "errorInvalidInput", label: "Error — rejected by server" },
  { key: "errorMailerUnavailable", label: "Error — mailer unavailable", multiline: true, rows: 2 },
  { key: "errorSendFailed", label: "Error — send failed", multiline: true, rows: 2 },
  { key: "errorNetwork", label: "Error — network" },
];

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

@Component({
  selector: "app-admin-contact",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiGroupEditorComponent],
  host: { class: "block" },
  template: `
    <app-ui-group-editor
      group="contact"
      title="Contact copy"
      description="Every label, placeholder and error message on the contact form."
      [fields]="fields"
    />
  `,
})
export default class AdminContactPage {
  protected readonly fields = FIELDS;
}
