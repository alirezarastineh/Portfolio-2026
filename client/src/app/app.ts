import { Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";

import { GrainOverlayComponent } from "./components/grain-overlay.component";
import { SiteFooterComponent } from "./components/site-footer.component";
import { SiteHeaderComponent } from "./components/site-header.component";

@Component({
  selector: "app-root",
  imports: [GrainOverlayComponent, RouterOutlet, SiteFooterComponent, SiteHeaderComponent],
  host: {
    class: "block min-h-screen",
  },
  template: `
    <app-site-header />
    <router-outlet />
    <app-site-footer />
    <app-grain-overlay />
  `,
})
export class App {}
