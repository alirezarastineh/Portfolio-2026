import { ChangeDetectionStrategy, Component, model } from "@angular/core";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmDialogImports } from "@spartan-ng/helm/dialog";

interface Shortcut {
  keys: string[];
  does: string;
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");
const MOD = MAC ? "⌘" : "Ctrl";

/** The keyboard shortcuts, by where they work. Plain letters never fire while typing in a field. */
export const SHORTCUTS: { where: string; items: Shortcut[] }[] = [
  {
    where: "Everywhere",
    items: [
      { keys: [MOD, "K"], does: "Jump to a section, or run an action" },
      { keys: ["?"], does: "Show these shortcuts" },
      { keys: ["Esc"], does: "Close a dialog or the palette" },
    ],
  },
  {
    where: "In an editor",
    items: [{ keys: [MOD, "S"], does: "Save the draft" }],
  },
  {
    where: "In the inbox",
    items: [
      { keys: ["J"], does: "Next message" },
      { keys: ["K"], does: "Previous message" },
      { keys: ["E"], does: "Archive the open message" },
      { keys: ["U"], does: "Mark the open message unread" },
    ],
  },
  {
    where: "In the assistant's reviews",
    items: [
      { keys: ["J"], does: "Next answer" },
      { keys: ["K"], does: "Previous answer" },
      { keys: ["1–5"], does: "Cycle a verdict: good, not good, does not apply" },
      { keys: ["S"], does: "Save the review and open the next answer" },
    ],
  },
];

/** The `?` sheet: every shortcut the admin has, in one place. */
@Component({
  selector: "app-shortcut-sheet",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmDialogImports],
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (stateChanged)="open.set($event === 'open')">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-md">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>Keyboard shortcuts</h2>
          <p hlmDialogDescription>Letters work anywhere but in a field you are typing in.</p>
        </hlm-dialog-header>
        <div class="flex flex-col gap-4">
          @for (group of groups; track group.where) {
            <section class="flex flex-col gap-2" [attr.aria-labelledby]="'keys-' + $index">
              <h3 [id]="'keys-' + $index" class="eyebrow m-0 text-muted-foreground">
                {{ group.where }}
              </h3>
              <dl class="m-0 flex flex-col gap-1.5">
                @for (item of group.items; track item.does) {
                  <div class="flex items-center justify-between gap-4 text-sm">
                    <dt class="order-2 flex shrink-0 items-center gap-1">
                      @for (key of item.keys; track key) {
                        <kbd class="kbd">{{ key }}</kbd>
                      }
                    </dt>
                    <dd class="order-1 m-0">{{ item.does }}</dd>
                  </div>
                }
              </dl>
            </section>
          }
        </div>
        <hlm-dialog-footer>
          <button hlmBtn type="button" (click)="open.set(false)">Close</button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class ShortcutSheetComponent {
  readonly open = model(false);
  protected readonly groups = SHORTCUTS;
}

/**
 * True when a plain-letter shortcut may act: no modifier (Shift aside, for
 * `?`), not already handled, and focus not in something that takes text.
 */
export function isShortcutTarget(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = event.target as HTMLElement | null;
  if (!target || typeof target.closest !== "function") return true;
  return !target.closest(
    "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role=textbox], [role=combobox], [role=dialog], [role=alertdialog]",
  );
}
