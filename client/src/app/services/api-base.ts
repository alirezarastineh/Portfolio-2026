/**
 * The API origin the browser calls (contact form, assistant), from the build's
 * `VITE_API_BASE_URL`. Empty means same-origin (the Vite dev proxy, or a
 * unified deploy).
 */
export function apiBaseUrl(): string {
  const meta = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  let fromEnv = meta?.["VITE_API_BASE_URL"];
  if (fromEnv && fromEnv.length > 0) {
    while (fromEnv.endsWith("/")) {
      fromEnv = fromEnv.slice(0, -1);
    }
    return fromEnv;
  }
  return "";
}
