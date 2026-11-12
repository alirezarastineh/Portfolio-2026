import { inject, InjectionToken, type ValueProvider } from "@angular/core";

export interface HlmSidebarConfig {
  sidebarWidth: string;
  sidebarWidthMobile: string;
  sidebarWidthIcon: string;
  /** Where the open-or-collapsed choice made from `openBreakpoint` up is kept (localStorage). */
  sidebarStorageKey: string;
  /** Up to this width the sidebar is a sheet. */
  mobileBreakpoint: string;
  /** From this width the sidebar starts open; below it, collapsed to icons. */
  openBreakpoint: string;
  closeMobileSidebarOnMenuButtonClick: boolean;
}

// The admin's rail (plan 5, U8): 232 px, 56 px collapsed; a sheet below 768, collapsed to 1279.
// Wider by a landscape notch, which the container pads. No keyboard shortcut here: the admin's
// `[` is in its layout, and Ctrl+B stays the editor's bold.
const defaultConfig: HlmSidebarConfig = {
  sidebarWidth: "calc(14.5rem + env(safe-area-inset-left, 0px))",
  sidebarWidthMobile: "18rem",
  sidebarWidthIcon: "calc(3.5rem + env(safe-area-inset-left, 0px))",
  sidebarStorageKey: "sidebar_state",
  mobileBreakpoint: "767.98px",
  openBreakpoint: "1280px",
  closeMobileSidebarOnMenuButtonClick: true,
};

const HlmSidebarConfigToken = new InjectionToken<HlmSidebarConfig>("HlmSidebarConfig");

export function provideHlmSidebarConfig(config: Partial<HlmSidebarConfig>): ValueProvider {
  return { provide: HlmSidebarConfigToken, useValue: { ...defaultConfig, ...config } };
}

export function injectHlmSidebarConfig(): HlmSidebarConfig {
  return inject(HlmSidebarConfigToken, { optional: true }) ?? defaultConfig;
}
