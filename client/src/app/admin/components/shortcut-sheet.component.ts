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
      { keys: [MOD, "K"], does: "Find a page, an action or content" },
      { keys: ["["], does: "Collapse or open the navigation" },
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
      { keys: ["R"], does: "Reply to the open message" },
      { keys: ["#"], does: "Mark the open message as spam" },
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
          <p hlmDialogDescription>
            Letters work anywhere but in a field you are typing in, a dialog or an open menu.
          </p>
        </hlm-dialog-header>
        <div class="flex flex-col gap-4">
          @for (group of groups; track group.where) {
            <section class="flex flex-col gap-2" [attr.aria-labelledby]="'keys-' + $index">
              <h3 [id]="'keys-' + $index" class="m-0 text-sm font-medium text-muted-foreground">
                {{ group.where }}
              </h3>
              <dl class="m-0 flex flex-col gap-1.5">
                @for (item of group.items; track item.does) {
                  <div class="flex items-center justify-between gap-4 text-sm">
                    <dt class="order-2 flex shrink-0 items-center gap-1">
                      @for (key of item.keys; track key) {
                        <kbd class="key-cap">{{ key }}</kbd>
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
  return !typingIn(event);
}

/**
 * The rail's key, `[`: as typed, or with AltGr, where a layout puts it (German: AltGr+8, which
 * Windows reports with Ctrl and Alt held). Never in a field or a dialog.
 */
export function isRailKey(event: KeyboardEvent): boolean {
  if (event.key !== "[" || event.defaultPrevented || event.metaKey) return false;
  const altGr = event.getModifierState?.("AltGraph") ?? false;
  if (!altGr && (event.ctrlKey || event.altKey)) return false;
  return !typingIn(event);
}

/** Focus is in something that takes text, in a dialog, or in a menu (it types ahead): the key is its own. */
function typingIn(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target || typeof target.closest !== "function") return false;
  return !!target.closest(
    "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role=textbox], [role=combobox], [role=dialog], [role=alertdialog], [role=menu], [role=menubar]",
  );
}
