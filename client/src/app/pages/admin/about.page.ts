import { ChangeDetectionStrategy, Component } from "@angular/core";
import type { RouteMeta } from "@analogjs/router";

import { unsavedChangesGuard } from "../../admin/unsaved-changes.service";

import {
  UiGroupEditorComponent,
  type UiFieldDef,
} from "../../admin/components/ui-group-editor.component";

const FIELDS: UiFieldDef[] = [
  { key: "heading", label: "Section heading", hint: "Rendered with the scramble effect." },
  { key: "subtitle", label: "Section subtitle" },
  {
    key: "philosophy",
    label: "Philosophy",
    multiline: true,
    rows: 10,
    hint: "The long paragraph in the About section.",
  },
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
  {
    key: "terminalOutputContact",
    label: "Output — cat contact.txt",
    multiline: true,
    rows: 3,
    hint: "No longer shown on the site.",
  },
  {
    key: "bio",
    label: "Bio",
    multiline: true,
    rows: 3,
    softMax: 200,
    hint: "Optional. One or two sentences on the card in the About section, under your name.",
  },
];

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

@Component({
  selector: "app-admin-about",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiGroupEditorComponent],
  host: { class: "block" },
  template: `
    <app-ui-group-editor
      group="about"
      title="About"
      description="The about section: its heading, the philosophy paragraph and the bio on the card."
      preview="/admin/preview/en#about"
      live="about"
      [fields]="fields"
    />
  `,
})
export default class AdminAboutPage {
  protected readonly fields = FIELDS;
}
