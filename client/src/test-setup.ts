import "@angular/compiler";
import "@analogjs/vitest-angular/setup-snapshots";
import "@analogjs/vitest-angular/setup-serializers";
import { setupTestBed } from "@analogjs/vitest-angular/setup-testbed";
import * as webStreams from "node:stream/web";

// jsdom has no web streams; browsers and Node do. The AI SDK (the About
// terminal's shell) needs them as soon as it loads.
for (const name of [
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "TextDecoderStream",
] as const) {
  (globalThis as Record<string, unknown>)[name] ??= webStreams[name];
}

setupTestBed();
