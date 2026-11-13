import { ChangeDetectionStrategy, Component } from "@angular/core";
import type { RouteMeta } from "@analogjs/router";

import { unsavedChangesGuard } from "../../admin/unsaved-changes.service";

import {
  UiGroupEditorComponent,
  type UiFieldDef,
} from "../../admin/components/ui-group-editor.component";

/** In the order the site reads them; the hidden ones last, kept and saved as they are. */
const FIELDS: UiFieldDef[] = [
  { key: "heading", label: "Section heading", section: "About section" },
  {
    key: "bio",
    label: "Bio",
    multiline: true,
    rows: 3,
    softMax: 200,
    hint: "Optional. The large statement at the top of the About section.",
    section: "About section",
  },
  {
    key: "philosophy",
    label: "Philosophy",
    multiline: true,
    rows: 10,
    hint: "The long paragraph in the About section. The tour shows its first sentence, and the assistant reads it.",
    section: "About section",
  },
  {
    key: "terminalOutputContact",
    label: "Tour: closing line",
    multiline: true,
    rows: 3,
    hint: "The guided tour's last stop, at the contact form: its first sentence is shown there.",
    section: "Guided tour",
  },
  { key: "subtitle", label: "Section subtitle" },
  { key: "terminalTitle", label: "Terminal window title", hint: "No longer shown on the site." },
  { key: "terminalPrompt", label: "Terminal prompt", hint: "e.g. user@portfolio:~$" },
  {
    key: "terminalOutputWhoami",
    label: "Output — whoami",
    multiline: true,
    rows: 2,
    hint: "No longer shown on the site.",
  },
  {
    key: "terminalOutputLs",
    label: "Output — ls skills/",
    multiline: true,
    rows: 2,
    hint: "No longer shown on the site.",
  },
];

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

@Component({
  selector: "app-admin-about",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiGroupEditorComponent],
  host: { class: "block" },
  template: `
    <app-ui-group-editor group="about" title="About" look="editor" live="about" [fields]="fields" />
  `,
})
export default class AdminAboutPage {
  protected readonly fields = FIELDS;
}
