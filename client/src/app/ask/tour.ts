import type { Locale } from "../content/locale";
import type { AppContent } from "../content/schema";
import { splitCommentMark } from "../i18n/comment-mark";
import { fmt } from "../i18n/interpolate";
import type { AskCopy } from "./ask-copy";
import type { AskMessage } from "./ask-types";
import { openTarget, type OutLine } from "./commands";

/**
 * The guided tour in the terminal (visitor plan V16). `tour` is the short
 * tour, made here from the published content with no model, so it works
 * offline and while the assistant rests; `tour <interest>` asks the server,
 * whose checked plan arrives as a `data-tour` part. The tour proposes; each
 * move is the visitor's own, to a path `openTarget` takes.
 */

/** A stop: the page, and the line that says why. */
export interface TourStop {
  /** The corpus's id where the page is a document (`project:atlas@en`); `about`, `contact` for a section. */
  id: string;
  title: string;
  url: string;
  line: string;
}

/** A replan's request, as `/v1/ask` takes it. */
export interface TourRequest {
  interest: string;
  from?: string;
  plan?: { messageId: string; stops: string[]; replanned: boolean; sig: string };
}

/** The tour in this tab (kept with the conversation, so a reload or the sheet keeps it). */
export interface TourState {
  kind: "default" | "plan";
  stops: TourStop[];
  /** The stop reached, from 0; -1 before the first. */
  at: number;
  /** The furthest stop reached: what a logged tour's signals report. */
  reached: number;
  /** The visitor's interest, for a planned tour. */
  interest?: string;
  /** A planned tour's answer, which the server logged and signed. */
  messageId?: string;
  sig?: string;
  /** Replanned once already: `tour more like this` is not offered again. */
  replanned: boolean;
}

/** The most an interest may be (the server's `TOUR_INTEREST_CHARS`). */
export const TOUR_INTEREST_CHARS = 120;

const LINE_CHARS = 160;

/** A text's first sentence, cut at 160 characters. */
function firstSentence(text: string): string {
  const sentence = text.trim().split(/(?<=[.!?])\s/)[0] ?? "";
  return sentence.length > LINE_CHARS ? `${sentence.slice(0, LINE_CHARS - 1)}…` : sentence;
}

/**
 * The short tour: the About section, the first case study in the content's
 * order, the newest post, the second case study, contact; each line the
 * page's own words. What the content lacks is left out.
 */
export function defaultTour(content: AppContent, locale: Locale): TourStop[] {
  const { ui } = content;
  const studies = content.projects.filter((p) => p.hasCaseStudy);
  const newest = [...content.posts].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
  const study = (p: AppContent["projects"][number] | undefined): TourStop[] =>
    p
      ? [
          {
            id: `project:${p.slug}@${locale}`,
            title: p.name,
            url: `/${locale}/work/${p.slug}`,
            line: firstSentence(p.descriptor || p.hook),
          },
        ]
      : [];
  return [
    {
      id: "about",
      title: splitCommentMark(ui.about.heading).text,
      url: `/${locale}#about`,
      line: firstSentence(ui.about.philosophy),
    },
    ...study(studies[0]),
    ...(newest
      ? [
          {
            id: `post:${newest.slug}@${locale}`,
            title: newest.title,
            url: `/${locale}/writing/${newest.slug}`,
            line: firstSentence(newest.excerpt),
          },
        ]
      : []),
    ...study(studies[1]),
    {
      id: "contact",
      title: splitCommentMark(ui.contact.heading).text,
      url: `/${locale}#contact`,
      line: firstSentence(ui.about.terminalOutputContact),
    },
  ];
}

/** The server's tour, from its answer's `data-tour` part; null when it has none, or a malformed one. */
export function tourData(message: AskMessage | undefined): {
  kind: "plan" | "default";
  interest: string;
  stops: TourStop[];
  replanned: boolean;
  sig: string;
} | null {
  const part = message?.parts.find((p) => p.type === "data-tour") as
    { data?: Record<string, unknown> } | undefined;
  const data = part?.data;
  if (data?.["v"] !== 1) return null;
  const kind = data["kind"];
  if (kind !== "plan" && kind !== "default") return null;
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const stops = Array.isArray(data["stops"])
    ? (data["stops"] as unknown[]).flatMap((raw): TourStop[] => {
        const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
        const stop = {
          id: str(s["id"]),
          title: str(s["title"]),
          url: str(s["url"]),
          line: str(s["line"]),
        };
        // The site's own paths only.
        return stop.id && stop.title && stop.url.startsWith("/") && !stop.url.startsWith("//")
          ? [stop]
          : [];
      })
    : [];
  if (kind === "plan" && !stops.length) return null;
  return {
    kind,
    interest: str(data["interest"]),
    stops: stops.slice(0, 5),
    replanned: data["replanned"] === true,
    sig: str(data["sig"]),
  };
}

const STOP_PATH = /^\/(en|de)(?:\/(?:work|writing)\/([a-z0-9-]+)|#([a-z]+))?$/;

/**
 * Where a move goes: the stop's path, only when `openTarget` maps the page it
 * names (its slug, its section, home) to exactly that path in this content. A
 * stop in the other language (a visitor writing it) is a path of that shape,
 * which the server checked against that language's pages.
 */
export function stopTarget(content: AppContent, locale: Locale, url: string): string | null {
  const match = STOP_PATH.exec(url);
  if (!match) return null;
  if (match[1] !== locale) return url;
  return openTarget(content, locale, match[2] ?? match[3] ?? "home") === url ? url : null;
}

/** The tour's stops, numbered, each a link: what `tour` prints. */
export function tourLines(state: TourState, copy: AskCopy["tour"]): OutLine[] {
  const head =
    state.kind === "plan" && state.interest
      ? fmt(copy.planned, { interest: state.interest, n: state.stops.length })
      : fmt(copy.short, { n: state.stops.length });
  return [
    { text: head, tone: "accent" },
    ...state.stops.map((stop, i) => ({
      label: String(i + 1),
      text: `${stop.title} — ${stop.line}`,
      href: stop.url,
      internal: true,
    })),
    { text: copy.howTo, tone: "dim" },
  ];
}

/** A stop reached: its line, a question about it, and, at the last, that it was the last. */
export function stopLines(state: TourState, copy: AskCopy["tour"]): OutLine[] {
  const stop = state.stops[state.at]!;
  const last = state.at === state.stops.length - 1;
  return [
    {
      label: fmt(copy.stop, { k: state.at + 1, n: state.stops.length }),
      text: `${stop.title} — ${stop.line}`,
      tone: "accent",
    },
    { text: copy.askAbout, ask: fmt(copy.question, { title: stop.title }) },
    ...(last ? [{ text: copy.last, tone: "dim" as const }] : []),
  ];
}

/** A page of the map, by its corpus id: `project:atlas@en`, `profile@en`; not `about` or `contact`. */
const PAGE_ID = /^[a-z-]+(?::[^@\s]+)?@(?:en|de)$/;

/** Whether the server can replan from a stop: one of the map's pages. */
export function replannable(stop: TourStop | undefined): boolean {
  return !!stop && PAGE_ID.test(stop.id);
}
