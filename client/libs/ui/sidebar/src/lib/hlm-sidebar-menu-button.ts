import { type BooleanInput } from "@angular/cdk/coercion";
import { booleanAttribute, computed, Directive, effect, inject, input } from "@angular/core";
import {
  BrnTooltip,
  BrnTooltipPosition,
  provideBrnTooltipDefaultOptions,
} from "@spartan-ng/brain/tooltip";
import {
  DEFAULT_TOOLTIP_CONTENT_CLASSES,
  DEFAULT_TOOLTIP_SVG_CLASS,
  tooltipPositionVariants,
} from "@spartan-ng/helm/tooltip";
import { classes, hlm } from "@spartan-ng/helm/utils";
import { cva } from "class-variance-authority";
import { HlmSidebarService } from "./hlm-sidebar.service";
import { injectHlmSidebarConfig } from "./hlm-sidebar.token";

// The admin's rail (plan 5, U8): muted at rest, the surface on hover and for the current entry,
// 32 px with a mouse and 44 on touch, and the site's focus ring, drawn inside the scrolled list.
// Collapsed to icons, an entry fills the rail's width with its icon in the middle.
const sidebarMenuButtonVariants = cva(
  "peer/menu-button text-muted-foreground hover:bg-surface-2 hover:text-foreground data-[active=true]:bg-surface-2 data-[active=true]:text-foreground data-[state=open]:hover:bg-surface-2 flex w-full items-center justify-start gap-2 overflow-hidden rounded-lg p-2 text-left text-sm transition-[width,height,padding] motion-reduce:transition-none focus-visible:-outline-offset-2 group-has-[[data-sidebar=menu-action]]/menu-item:pr-8 group-data-[collapsible=icon]:!w-full group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:!p-0 cursor-pointer touch-manipulation disabled:pointer-events-none disabled:opacity-50 disabled:cursor-default aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:font-medium [&>_ng-icon]:size-4 [&>_ng-icon]:shrink-0 group-data-[collapsible=icon]:[&>span]:hidden [&>span:last-child]:truncate",
  {
    variants: {
      variant: {
        default: "",
        outline: "border border-input-line bg-transparent",
      },
      size: {
        default: "h-8 pointer-coarse:h-11 text-sm",
        sm: "h-7 pointer-coarse:h-11 text-xs",
        lg: "h-12 text-sm group-data-[collapsible=icon]:!p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

@Directive({
  selector: "button[hlmSidebarMenuButton], a[hlmSidebarMenuButton]",
  providers: [
    provideBrnTooltipDefaultOptions({
      showDelay: 150,
      hideDelay: 0,
      tooltipContentClasses: DEFAULT_TOOLTIP_CONTENT_CLASSES,
      svgClasses: DEFAULT_TOOLTIP_SVG_CLASS,
      arrowClasses: (position: BrnTooltipPosition) => hlm(tooltipPositionVariants({ position })),
      position: "right",
    }),
  ],
  hostDirectives: [
    {
      directive: BrnTooltip,
      inputs: ["brnTooltip: tooltip"],
    },
  ],
  host: {
    "data-slot": "sidebar-menu-button",
    "data-sidebar": "menu-button",
    "[attr.data-size]": "size()",
    "[attr.data-active]": "isActive()",
    "(click)": "onClick()",
  },
})
export class HlmSidebarMenuButton {
  private readonly _config = injectHlmSidebarConfig();
  private readonly _sidebarService = inject(HlmSidebarService);
  private readonly _brnTooltip = inject(BrnTooltip);

  public readonly variant = input<"default" | "outline">("default");
  public readonly size = input<"default" | "sm" | "lg">("default");
  public readonly isActive = input<boolean, BooleanInput>(false, { transform: booleanAttribute });
  public readonly closeMobileSidebarOnClick = input<boolean, BooleanInput>(
    this._config.closeMobileSidebarOnMenuButtonClick,
    { transform: booleanAttribute },
  );

  protected readonly _isTooltipHidden = computed(
    () => this._sidebarService.state() !== "collapsed" || this._sidebarService.isMobile(),
  );

  constructor() {
    classes(() => sidebarMenuButtonVariants({ variant: this.variant(), size: this.size() }));
    effect(() => this._brnTooltip.mutableTooltipDisabled.set(this._isTooltipHidden()));
  }

  protected onClick(): void {
    if (this.closeMobileSidebarOnClick()) {
      this._sidebarService.setOpenMobile(false);
    }
  }
}
