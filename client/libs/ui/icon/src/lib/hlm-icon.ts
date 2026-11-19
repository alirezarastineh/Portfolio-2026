import { Directive, computed, input } from "@angular/core";
import { injectHlmIconConfig } from "./hlm-icon.token";

export type IconSize =
  "xs" | "sm" | "base" | "lg" | "xl" | "none" | (Record<never, never> & string);

const ICON_SIZE_MAP = new Map<string, string>([
  ["xs", "12px"],
  ["sm", "16px"],
  ["base", "24px"],
  ["lg", "32px"],
  ["xl", "48px"],
]);

@Directive({
  selector: "ng-icon[hlmIcon], ng-icon[hlm]",
  host: {
    "[style.--ng-icon__size]": "_computedSize()",
  },
})
export class HlmIcon {
  private readonly _config = injectHlmIconConfig();
  public readonly size = input<IconSize>(this._config.size);

  protected readonly _computedSize = computed((): string => {
    const size = this.size();
    return ICON_SIZE_MAP.get(size) ?? size;
  });
}
