import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every paid action in the admin says "(paid)" before it is pressed (plan 5, U19): a control whose
 * click, menu pick or form submit reaches a call that runs a paid model, directly or through its
 * file's own methods (and a parent class's), says it in its text and in its `aria-label`, if any.
 */

const here = dirname(fileURLToPath(import.meta.url));
const APP = resolve(here, "..");

/** The calls that spend: the admin API's paid requests, and the Playground's stream. */
const PAID_CALL =
  /\bapi\.(?:copilot|draftFaqProposal|assistantInsights|startEvalRun|startPairwiseRun|startReplayRun|startContentRun|startJudgeRun|resumeRun)\(|\bchat\.sendMessage\(/;

/** A method's head at a class's indent: its name, and its body runs to the next head. */
const METHOD = /^ {2}(?:(?:protected|private|public|readonly|static|async)\s+)*(\w+)\s*\(/gm;
/** An element's opening tag, its quoted attribute values read whole (as `described-by.spec.ts`). */
const TAG = /<[a-z](?:[^<>"']|"[^"]*"|'[^']*')*>/g;

/** A tag's element name: "button" from `<button hlmBtn …>`. */
const nameOf = (tag: string): string => tag.slice(1).split(/[\s/>]/)[0];
const HANDLER = /\((?:click|triggered|submit|ngSubmit)\)="([^"]*)"/g;
const LABEL = /\[?(?:attr\.)?aria-label\]?="([^"]*)"/;

interface Source {
  file: string;
  text: string;
}

/** The methods of a file's classes, by name, each with its body. */
function methodsOf(text: string): Map<string, string> {
  const heads = [...text.matchAll(METHOD)];
  return new Map(
    heads.map((head, i) => [head[1], text.slice(head.index, heads[i + 1]?.index ?? text.length)]),
  );
}

/** The names of a file's methods that spend: those that call a paid API, or one of these. */
function paidMethods(text: string, inherited: ReadonlySet<string> = new Set()): Set<string> {
  const methods = methodsOf(text);
  const paid = new Set(inherited);
  for (const [name, body] of methods) {
    if (PAID_CALL.test(body)) {
      paid.add(name);
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, body] of methods) {
      if (!paid.has(name) && [...paid].some((method) => body.includes(`.${method}(`))) {
        paid.add(name);
        grew = true;
      }
    }
  }
  return paid;
}

/** The names a handler calls: the word before each "(". */
const calls = (handler: string): string[] =>
  handler
    .split("(")
    .slice(0, -1)
    .map((part) => part.split(/\W/).at(-1) ?? "");

/** The controls a template offers for a paid method, each as its text and its label, if any. */
function paidControls(text: string, paid: ReadonlySet<string>): string[] {
  const template = /template: `([^`]*)`/.exec(text)?.[1] ?? "";
  const controls: string[] = [];
  for (const tag of template.matchAll(TAG)) {
    const handlers = [...tag[0].matchAll(HANDLER)].flatMap(([, handler]) => calls(handler));
    if (!handlers.some((name) => paid.has(name))) {
      continue;
    }
    const start = tag.index + tag[0].length;
    const end = template.indexOf(`</${nameOf(tag[0])}>`, start);
    const inner = template.slice(start, end);
    // A form spends through its submit buttons; anything else through itself.
    const buttons =
      nameOf(tag[0]) === "form"
        ? [...inner.matchAll(TAG)].filter(([button]) => /^<button\b[^>]*type="submit"/.test(button))
        : [tag];
    for (const button of buttons) {
      const from = button === tag ? start : start + button.index + button[0].length;
      const content = template.slice(from, template.indexOf("</button>", from));
      const label = LABEL.exec(button[0])?.[1];
      controls.push([content, label].filter((part) => part !== undefined).join(" | "));
    }
  }
  return controls;
}

/** The app's sources under src/app, specs aside. */
function sources(dir: string): Source[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sources(path);
    }
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")
      ? [{ file: relative(APP, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") }]
      : [];
  });
}

/** Each paid control in the admin, its file first, and whether it says "(paid)" (text and label). */
function adminPaidControls(): { control: string; says: boolean }[] {
  const admin = sources(APP).filter(({ file }) => /^(?:admin|pages\/admin)/.test(file));
  // A class's paid methods reach the templates of the classes that extend it (the bilingual field).
  const byClass = new Map<string, Set<string>>();
  for (const { text } of admin) {
    const paid = paidMethods(text);
    for (const [, name] of text.matchAll(/export class (\w+)/g)) {
      byClass.set(name, paid);
    }
  }
  return admin.flatMap(({ file, text }) => {
    const parents = [...text.matchAll(/class \w+ extends (\w+)/g)].flatMap(([, parent]) => [
      ...(byClass.get(parent) ?? []),
    ]);
    return paidControls(text, paidMethods(text, new Set(parents))).map((control) => ({
      control: `${file}: ${control.replaceAll(/\s+/g, " ").trim()}`,
      says: control.split(" | ").every((part) => part.includes("(paid)")),
    }));
  });
}

describe("paid actions", () => {
  it("are found through a file's own methods, a form's submit and a parent class", () => {
    const fixture = [
      "@Component({ template: `",
      '  <button hlmBtn (click)="go()">Go</button>',
      '  <button hlmBtn (click)="free()">Free</button>',
      '  <button hlmBtn (click)="go()" [attr.aria-label]="\'Go with AI\'">Go (paid)</button>',
      '  <form (submit)="$event.preventDefault(); send()"><button type="submit">Send</button></form>',
      "` })",
      "class Fixture {",
      "  protected async go(): Promise<void> {",
      "    await this.api.copilot({});",
      "  }",
      "  protected free(): void {}",
      "  protected send(): void {",
      "    this.session.go();",
      "  }",
      "}",
    ].join("\n");
    expect(paidControls(fixture, paidMethods(fixture))).toEqual([
      "Go",
      "Go (paid) | 'Go with AI'",
      "Send",
    ]);
    const child = '@Component({ template: `<button (triggered)="go()">Go (paid)</button>` })';
    expect(paidControls(child, paidMethods(child, new Set(["go"])))).toEqual(["Go (paid)"]);
  });

  it('say "(paid)" before they are pressed, in every admin template', () => {
    const controls = adminPaidControls();
    // The scan reads them all: the Assistant's, the editors' and the content agent's.
    expect(controls.length).toBeGreaterThan(20);
    expect(controls.filter(({ says }) => !says).map(({ control }) => control)).toEqual([]);
  });
});
