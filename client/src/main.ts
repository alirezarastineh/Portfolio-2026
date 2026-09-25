import { bootstrapApplication } from "@angular/platform-browser";

import { App } from "./app/app";
import { markWhenInteractive } from "./app/app-interactive";
import { appConfig } from "./app/app.config";

const appRef = await bootstrapApplication(App, appConfig);
markWhenInteractive(appRef, document);
