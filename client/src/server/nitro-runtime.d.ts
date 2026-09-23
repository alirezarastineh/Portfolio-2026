/**
 * Nitro's runtime API, as the server routes use it. `nitropack` comes with
 * Analog rather than as a direct dependency, and Nitro resolves this import at
 * build time; the declaration only gives the type checker the one function.
 */
declare module "nitropack/runtime" {
  interface Storage {
    getItemRaw<T = unknown>(key: string): Promise<T | null>;
  }
  export function useStorage(base?: string): Storage;
}
