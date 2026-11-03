import { bootstrapApplication } from "@angular/platform-browser";

import { App } from "./app/app";
import { markWhenInteractive } from "./app/app-interactive";
import { appConfig } from "./app/app.config";

const appRef = await bootstrapApplication(App, appConfig);
await markWhenInteractive(appRef, document);

// The visitor's own agent (plan 3 W6): its tools load only where the browser offers WebMCP.
if ("modelContext" in document || "modelContext" in navigator) {
  const { declareAgentTools } = await import("./app/ask/agent-tools");
  await declareAgentTools(appRef.injector);
}
