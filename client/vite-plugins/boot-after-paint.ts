import type { Plugin } from "vite";

/**
 * The id of the inline loader below. The CSP middleware nonces it by this id
 * (`src/app/security/csp-nonce.ts`, `APP_BOOT_SCRIPT_ID`): keep them equal.
 */
export const APP_BOOT_SCRIPT_ID = "app-boot";

/**
 * Starts the app's JavaScript after the first paint instead of with it.
 *
 * Every page is server-rendered in full, so nothing on screen waits for the
 * bundle; Angular's event replay (the inline event-dispatch contract) keeps
 * any click made before hydration and plays it back. Fetched with the page,
 * though, the entry and its ~14 module preloads (~155 KB compressed) share
 * the connection with the stylesheet and the fonts and push the first paint
 * back on a slow link. So the build swaps the entry `<script>` and its
 * `modulepreload` links for a tiny loader that adds them once the page has
 * painted — after DOMContentLoaded, so `zod-config.js` (a deferred classic
 * script) still runs first.
 *
 * Build only: the dev server keeps Vite's own tags.
 */
export function bootAfterPaint(): Plugin {
  return {
    name: "boot-after-paint",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const entry = /<script type="module" crossorigin src="([^"]+)"><\/script>\s*/.exec(html);
        if (!entry) return html;
        const preloads = [
          ...html.matchAll(/<link rel="modulepreload" crossorigin href="([^"]+)">\s*/g),
        ];

        let out = html.replace(entry[0], "");
        for (const preload of preloads) out = out.replace(preload[0], "");
        const loader = loaderSource(
          entry[1]!,
          preloads.map((p) => p[1]!),
        );
        return out.replace(
          "</head>",
          `<script id="${APP_BOOT_SCRIPT_ID}">${loader}</script>\n</head>`,
        );
      },
    },
  };
}

/**
 * ES5 on purpose: it runs before any polyfill, in every browser that loads
 * the page.
 *
 * "After the first paint" means after the first *contentful* paint: the very
 * first frame can be the background alone, while text waits out the fonts'
 * short block period. So it waits for the Paint Timing entry where there is
 * one, else for the fonts, then a frame and a task — and a timer boots it
 * regardless (a background tab paints nothing).
 *
 * A page whose server render holds no text boots at once: the admin's
 * skeleton, say, never makes a contentful paint, and shows nothing until the
 * app runs.
 */
export function loaderSource(entry: string, preloads: readonly string[]): string {
  return [
    "(function(){",
    `var entry=${JSON.stringify(entry)},preloads=${JSON.stringify(preloads)},started=false;`,
    "function boot(){if(started)return;started=true;",
    "for(var i=0;i<preloads.length;i++){var l=document.createElement('link');",
    "l.rel='modulepreload';l.crossOrigin='';l.href=preloads[i];document.head.appendChild(l);}",
    "import(entry).catch(function(e){console.error(e);});}",
    "function soon(){requestAnimationFrame(function(){setTimeout(boot,0);});}",
    "function painted(){",
    "try{var p=performance.getEntriesByName('first-contentful-paint');if(p&&p.length){soon();return;}",
    "var o=new PerformanceObserver(function(list){if(list.getEntriesByName('first-contentful-paint').length){o.disconnect();soon();}});",
    "o.observe({type:'paint',buffered:true});}",
    "catch(e){if(document.fonts&&document.fonts.ready){document.fonts.ready.then(soon);}else{soon();}}}",
    "function start(){var root=document.querySelector('app-root');",
    String.raw`if(!root||!/\S/.test(root.textContent||'')){boot();return;}`,
    "painted();setTimeout(boot,2500);}",
    "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',start);}else{start();}",
    "})();",
  ].join("");
}
