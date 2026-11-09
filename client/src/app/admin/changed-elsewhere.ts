import type { ConfirmService } from "./components/confirm-dialog.component";

interface Versioned {
  id: string;
  updatedAt: string;
}

/**
 * Collection items save without a version (the server's last write wins), so an
 * editor remembers what it loaded and reads again before saving. Items it has
 * no version for (one added since) pass.
 */
export class ChangedElsewhere {
  private known = new Map<string, string>();

  constructor(
    private readonly confirm: ConfirmService,
    /** The items as the server has them now; null when they could not be read. */
    private readonly read: () => Promise<readonly Versioned[] | null>,
  ) {}

  remember(items: readonly Versioned[]): void {
    this.known = new Map(items.map((item) => [item.id, item.updatedAt]));
  }

  /** After this editor's own write (a save, a reorder), which moves the versions too. */
  async refresh(): Promise<void> {
    const items = await this.read();
    if (items) this.remember(items);
  }

  /** Whether the save may go ahead: nothing changed there, or the person chose to replace it. */
  async mayOverwrite(ids: readonly string[], what: string): Promise<boolean> {
    if (!ids.length) return true;
    const items = await this.read();
    const moved = items?.some((item) => {
      const known = this.known.get(item.id);
      return ids.includes(item.id) && known !== undefined && known !== item.updatedAt;
    });
    if (!moved) return true;
    return this.confirm.ask({
      title: "Changed elsewhere",
      description: `${what} changed in another tab or session since you opened it. Saving replaces that version.`,
      confirmLabel: "Save anyway",
      cancelLabel: "Keep editing",
      destructive: true,
    });
  }
}
