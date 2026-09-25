/**
 * Cloudflare Turnstile, for the contact form and the assistant — off unless
 * the build has a site key (VITE_TURNSTILE_SITE_KEY) and the API a secret.
 * Nothing loads until a token is needed: a visitor who never sends anything
 * never talks to Cloudflare.
 */
export const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "").trim();

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  execute(widgetId: string): void;
  remove(widgetId: string): void;
}

let api: Promise<TurnstileApi> | null = null;

function loadApi(): Promise<TurnstileApi> {
  api ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      const loaded = (globalThis as { turnstile?: TurnstileApi }).turnstile;
      if (loaded) resolve(loaded);
      else reject(new Error("turnstile did not load"));
    };
    script.onerror = () => reject(new Error("turnstile did not load"));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    api = null; // a later attempt may succeed
    throw error;
  });
  return api;
}

/**
 * A fresh, single-use token, or "" when Turnstile is off. The widget runs
 * invisibly; only a visitor Cloudflare is unsure about sees a check box,
 * shown in `host` (or a small panel at the bottom of the screen).
 */
export async function turnstileToken(locale: string, host?: HTMLElement): Promise<string> {
  if (!TURNSTILE_SITE_KEY) return "";
  const turnstile = await loadApi();

  const box = document.createElement("div");
  if (!host) {
    box.style.cssText = "position:fixed;left:50%;bottom:1rem;transform:translateX(-50%);z-index:60";
  }
  (host ?? document.body).appendChild(box);

  return new Promise<string>((resolve, reject) => {
    let id = "";
    const done = () => {
      if (id) turnstile.remove(id);
      box.remove();
    };
    id = turnstile.render(box, {
      sitekey: TURNSTILE_SITE_KEY,
      language: locale,
      appearance: "interaction-only",
      execution: "execute",
      callback: (token: string) => {
        done();
        resolve(token);
      },
      "error-callback": () => {
        done();
        reject(new Error("turnstile_failed"));
      },
      "timeout-callback": () => {
        done();
        reject(new Error("turnstile_timeout"));
      },
    });
    turnstile.execute(id);
  });
}
