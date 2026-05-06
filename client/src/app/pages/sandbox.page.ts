import { Component } from "@angular/core";

import { MagneticButtonComponent } from "../components/magnetic-button.component";
import { ScrambleTextComponent } from "../components/scramble-text.component";
import { SpotlightCardComponent } from "../components/spotlight-card.component";
import { TerminalWindowComponent } from "../components/terminal-window.component";

@Component({
  selector: "app-sandbox",
  imports: [
    MagneticButtonComponent,
    ScrambleTextComponent,
    SpotlightCardComponent,
    TerminalWindowComponent,
  ],
  template: `
    <main class="mx-auto max-w-7xl px-6 pb-16 pt-28">
      <h1 class="mb-2 mt-0 font-mono text-[clamp(2rem,4vw,3rem)] font-medium tracking-normal">
        <app-scramble-text text="// sandbox" />
      </h1>
      <p class="mb-12 mt-0 text-muted-foreground">Phase 2 primitives — visual sanity check.</p>

      <section class="mb-14">
        <h2
          class="mb-4 mt-0 font-mono text-[0.85rem] lowercase tracking-wider text-muted-foreground"
        >
          SpotlightCard
        </h2>
        <div class="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          <app-spotlight-card class="min-h-40">
            <div class="p-5">
              <h3 class="font-mono text-sm">core-architecture</h3>
              <p class="text-sm text-muted-foreground">
                Move your cursor over the card. The radial gradient tracks the pointer.
              </p>
            </div>
          </app-spotlight-card>
          <app-spotlight-card class="min-h-40">
            <div class="p-5">
              <h3 class="font-mono text-sm">ai-ml-stack</h3>
              <p class="text-sm text-muted-foreground">
                Hover triggers the indigo edge glow plus the spotlight.
              </p>
            </div>
          </app-spotlight-card>
          <app-spotlight-card class="min-h-40">
            <div class="p-5">
              <h3 class="font-mono text-sm">devops</h3>
              <p class="text-sm text-muted-foreground">
                Pure CSS, no GSAP. Pointer position pushed via custom props.
              </p>
            </div>
          </app-spotlight-card>
        </div>
      </section>

      <section class="mb-14">
        <h2
          class="mb-4 mt-0 font-mono text-[0.85rem] lowercase tracking-wider text-muted-foreground"
        >
          MagneticButton
        </h2>
        <div class="flex flex-wrap gap-4">
          <app-magnetic-button variant="primary">{{ "> view_projects()" }}</app-magnetic-button>
          <app-magnetic-button variant="secondary">{{ "cd ./contact" }}</app-magnetic-button>
          <app-magnetic-button variant="primary" href="https://github.com/alirezarastineh">
            github
          </app-magnetic-button>
        </div>
      </section>

      <section class="mb-14">
        <h2
          class="mb-4 mt-0 font-mono text-[0.85rem] lowercase tracking-wider text-muted-foreground"
        >
          ScrambleText
        </h2>
        <div class="font-mono text-2xl">
          <app-scramble-text text="// hardcore rigor + cutting-edge AI" />
        </div>
      </section>

      <section class="mb-14">
        <h2
          class="mb-4 mt-0 font-mono text-[0.85rem] lowercase tracking-wider text-muted-foreground"
        >
          TerminalWindow
        </h2>
        <app-terminal-window title="user@portfolio — zsh">
          <div><span class="text-accent-orange">user&#64;portfolio:~$</span> whoami</div>
          <div class="text-muted-foreground">
            Alireza Rastineh — Full Stack AI Software Engineer
          </div>
          <div class="h-2"></div>
          <div><span class="text-accent-orange">user&#64;portfolio:~$</span> ls skills/</div>
          <div class="text-muted-foreground">
            core-architecture/ ai-ml-stack/ devops/ data-pipelines/
          </div>
        </app-terminal-window>
      </section>

    </main>
  `,
})
export default class Sandbox {}
