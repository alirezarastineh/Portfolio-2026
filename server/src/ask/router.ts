/**
 * Lite or deep, and how carefully (plan phase 20, Complexity-Based Routing).
 * Most questions go to the fast, cheap primary model; the deep model takes
 * comparisons, "why" and "how would" questions, architecture, and questions
 * that span several projects — or anything after the `deep` command. Two
 * refinements ride on top, and neither moves anything before the corpus:
 *
 * - **sensitive** (the newspaper test: what would be bad to see quoted):
 *   pay and rates, visas and permits, contracts and clients, health, family,
 *   politics, private details. The answer gets a strict block after the
 *   corpus (prompt.ts): stated facts from the profile or the FAQ only, cited,
 *   else "not published" and the contact command.
 * - **lookup**: a short who/where/when/which question on the lite route gets
 *   the primary model with minimal thinking (the cheapest tier that answers).
 *
 * Routing errors are asymmetric (an easy question over-served costs little, a
 * hard one under-served costs the answer): a sensitive question is never a
 * lookup, and an answer routed lite may still move to the deep chain mid-way
 * (`escalationOf`, agent.ts), never back. Cheap and deterministic; every
 * decision is logged with its reason.
 */

export type Route = "lite" | "deep";

/** What a sensitive question touches. */
export type Sensitivity =
  "compensation" | "immigration" | "contract" | "health" | "family" | "politics" | "private";

export interface RouteDecision {
  route: Route;
  reason: string;
  /** The careful block's topic; absent when the question is ordinary. */
  sensitive?: Sensitivity;
  /** The cheapest tier: the primary model with minimal thinking. */
  lookup?: boolean;
  /**
   * The visitor wants to hire, interview, work with or reach him, or asks for
   * a quote (visitor plan V6, `contactIntentOf`): the answer gets the request
   * block, and the hand-off is offered by the model or, failing that, the
   * server. Absent for any other question.
   */
  intent?: "contact";
}

const DEEP_PATTERNS: [RegExp, string][] = [
  [/\b(compare|comparison|versus|vs\.?|difference between|differ)\b/i, "compare"],
  [/\b(vergleich\w*|unterschied\w*|gegenüber)\b/i, "compare"],
  [/\b(why|how would|how did he (?:design|architect|decide)|trade-?offs?)\b/i, "why"],
  [/\b(warum|wieso|weshalb|wie würde|abwägung\w*)\b/i, "why"],
  [
    /\b(architect\w*|system design|design decisions?|scal\w+ (?:to|up)|infrastructure)\b/i,
    "architecture",
  ],
  [/\b(architektur\w*|systemdesign|designentscheidung\w*|infrastruktur)\b/i, "architecture"],
];

/**
 * The newspaper test's topics, English and German. Every pattern needs the
 * person as well as the topic ("his …", "does he have …", "is he …"), so a
 * project in such a domain stays an ordinary question: rate limits, a
 * mobile app, a saga's compensation, Visa payments, the clients an API
 * supports, an app that tracks health conditions, campaign software, a
 * phone-number validator. The near misses and the misses the reviewer found
 * are tests (router.spec.ts).
 */
const SENSITIVE_PATTERNS: [RegExp, Sensitivity][] = [
  [/\b(?:his|what|expected) salar(?:y|ies)\b/i, "compensation"],
  [/\bsalary expectations?\b/i, "compensation"],
  [/\bhis (?:income|compensation)\b/i, "compensation"],
  [/\bpay ?(?:check|slip|range)\b/i, "compensation"],
  [/\bpay expectations?\b/i, "compensation"],
  [/\b(?:day|hourly|daily) rates?\b(?!\s*limit)/i, "compensation"],
  [/\b(?:freelance|his) rates?\b(?!\s*limit)/i, "compensation"],
  [/\bhow much (?:does|would) he (?:charge|cost|earn|make|ask)\b/i, "compensation"],
  [/\bhow much (?:did|will) he (?:charge|cost|earn|make|ask)\b/i, "compensation"],
  [/\bwhat (?:does|would) he (?:charge|earn|cost)\b/i, "compensation"],
  [/\bwhat (?:did|will) he (?:charge|earn|cost)\b/i, "compensation"],
  [/\bhow (?:expensive|pricey) is he\b/i, "compensation"],
  [/\bsein\w* (?:gehalt|vergütung|honorar)\b/i, "compensation"],
  [/\bwelches gehalt\b/i, "compensation"],
  [/\bgehaltsvorstellung\w*\b/i, "compensation"],
  [/\b(?:stundensatz|tagessatz)\b/i, "compensation"],
  [/\b(?:wie ?viel|was) (?:verdient|kostet|nimmt) er\b/i, "compensation"],
  [/\b(?:need|needs|require|requires)(?: a)? (?:work )?visas?\b/i, "immigration"],
  [/\b(?:get|got|has|have)(?: a)? (?:work )?visas?\b/i, "immigration"],
  [/\bwithout(?: a)? (?:work )?visas?\b/i, "immigration"],
  [/\bhis visa\b/i, "immigration"],
  [/\bwork visas?\b/i, "immigration"],
  [/\bvisa (?:sponsorship|status|requirements?)\b/i, "immigration"],
  [/\b(?:work|residence) permit\b/i, "immigration"],
  [/\b(?:blue|green) card\b/i, "immigration"],
  [/\b(?:citizenship|right to work|h-?1b)\b/i, "immigration"],
  [/\bwork authori[sz]ation\b/i, "immigration"],
  [/\b(?:authori[sz]ed|eligible|allowed|permitted) to work\b/i, "immigration"],
  [/\b(?:need|needs|require|requires|without) sponsorship\b/i, "immigration"],
  [/\bhis (?:immigration|residency) status\b/i, "immigration"],
  [/\b(?:visum|arbeitserlaubnis|arbeitsgenehmigung|blaue karte)\b/i, "immigration"],
  [/\baufenthalts(?:titel|erlaubnis|status)\b/i, "immigration"],
  [/\b(?:staatsbürgerschaft|staatsangehörigkeit|einbürgerung)\b/i, "immigration"],
  [/\b(?:nda|non-disclosure|contract terms|client list)\b/i, "contract"],
  [/\bfor which clients\b/i, "contract"],
  [/\bhis (?:past |former |current )?(?:contracts?|clients)\b/i, "contract"],
  [/\bwhich clients (?:did|has|have|does) he\b/i, "contract"],
  [/\b(?:vertragsbedingungen|kundenliste|seine kunden)\b/i, "contract"],
  [/\bsein\w* vertrag\b/i, "contract"],
  [/\bwelche kunden (?:hatte|hat) er\b/i, "contract"],
  [/\bhis (?:mental )?health\b/i, "health"],
  [/\bhis medical (?:history|conditions?|records?|issues?|problems?)\b/i, "health"],
  [/\bhis health (?:history|conditions?|records?|issues?|problems?)\b/i, "health"],
  [
    /\b(?:does|has) he (?:have|got|had) (?:any )?medical (?:conditions?|issues?|problems?)\b/i,
    "health",
  ],
  [
    /\b(?:does|has) he (?:have|got|had) (?:any )?health (?:conditions?|issues?|problems?)\b/i,
    "health",
  ],
  [/\bis he (?:sick|ill|disabled|unwell)\b/i, "health"],
  [/\b(?:his|a) disabilit(?:y|ies)\b/i, "health"],
  [/\b(?:his|an|any) illness(?:es)?\b/i, "health"],
  [/\b(?:medical|sick) leave\b/i, "health"],
  [/\bseine gesundheit\b/i, "health"],
  [/\bist er (?:krank|behindert)\b/i, "health"],
  [/\bkrankgeschrieben\b/i, "health"],
  [/\b(?:seine|eine) (?:krankheit|behinderung|erkrankung)\b/i, "health"],
  [/\bis he (?:married|single|engaged|divorced)\b/i, "family"],
  [/\b(?:his|is he) religio\w+\b/i, "family"],
  [/\breligious (?:views?|beliefs?)\b/i, "family"],
  [/\bhis (?:wife|husband|partner|spouse|girlfriend|boyfriend|kids|children|family)\b/i, "family"],
  [
    /\b(?:does|has) he (?:have|got) (?:a )?(?:wife|husband|girlfriend|boyfriend|partner)\b/i,
    "family",
  ],
  [/\b(?:does|has) he (?:have|got) (?:kids|children|family)\b/i, "family"],
  [/\bist er (?:verheiratet|religiös)\b/i, "family"],
  [/\bseine (?:frau|ehefrau|freundin|partnerin|kinder|familie|religion)\b/i, "family"],
  [/\bhat er (?:eine (?:frau|freundin|partnerin)|kinder|familie)\b/i, "family"],
  [/\bhis politic\w*\b/i, "politics"],
  [/\bpolitical (?:views?|opinions?|leanings?|affiliation|party)\b/i, "politics"],
  [/\bwho (?:did|does|would|will) he vote\b/i, "politics"],
  [/\b(?:which party|party member\w*)\b/i, "politics"],
  [/\b(?:seine )?politische\w* (?:meinung|einstellung|haltung)\b/i, "politics"],
  [/\b(?:wen wählt er|welche partei)\b/i, "politics"],
  [/\bparteimitglied\w*\b/i, "politics"],
  [/\bhome address\b/i, "private"],
  [/\bhis (?:home |private )?address\b/i, "private"],
  [/\bprivate (?:email|address)\b/i, "private"],
  [/\b(?:his|private|personal) phone numbers?\b/i, "private"],
  [/\b(?:his|private|personal) (?:mobile|cell)(?: phone)? numbers?\b/i, "private"],
  [/\b(?:name|email|number|phone) of his (?:manager|boss|supervisor)\b/i, "private"],
  [/\b(?:name|email|number|phone) of his (?:colleagues?|references?)\b/i, "private"],
  [/\bhis (?:manager|boss|supervisor)'?s? (?:names?|emails?|numbers?|contact)\b/i, "private"],
  [/\bhis colleagues?'?s? (?:names?|emails?|numbers?|contact)\b/i, "private"],
  [/\bwho (?:was|is|were|are) his (?:manager|boss|supervisor)\b/i, "private"],
  [/\bwho (?:was|is|were|are) his (?:colleagues?|references?)\b/i, "private"],
  [/\bwho (?:did|does) he report to\b/i, "private"],
  [/\bhis references\b/i, "private"],
  // Not a word joined on ("Telefonnummer-Validierung" is a project).
  [/\bseine (?:telefonnummer|handynummer|adresse|wohnadresse)\b(?!-)/i, "private"],
  [/\b(?:privatnummer|wohnadresse|privatadresse)\b(?!-)/i, "private"],
  [/\bwer (?:war|ist) sein(?:e)? (?:chef(?:in)?|vorgesetzter?|kolleg\w*)\b/i, "private"],
  [/\bwie hei(?:ß|ss)t sein(?:e)? (?:chef(?:in)?|vorgesetzter?|kolleg\w*)\b/i, "private"],
  [/\bseine referenzen\b/i, "private"],
];

/** Him, as a visitor names him to the assistant: "him", his name, or "you" for the site. */
const HIM = "(?:him|alireza|rastineh|you)";
/** Him only: "call you" and "talk to you" are said to the assistant itself. */
const ONLY_HIM = "(?:him|alireza|rastineh)";
/** German: "ihn", his name, "dich" ("Sie" is "they" too, so it is left out). */
const IHN = "(?:ihn|alireza|rastineh|dich)";
/** The visitor as the one who wants it, in German. */
const ICH = "(?:ich|wir|mir|uns)";
/**
 * The visitor wanting it: "I'd like", "we want", "we're looking", "we'd be happy to", "can we",
 * "how do I", "let's". An apostrophe is typed straight or curly.
 */
const WANT = String.raw`(?:\b(?:i|we)(?:['’]d| would)? (?:like|love|want|hope|plan|need|wish)\b|\b(?:i|we)(?:['’]d| would) be (?:glad|happy|interested|keen|open)\b|\b(?:i|we)(?:['’]re| are|['’]m| am) (?:looking|keen|interested|hoping|planning|thinking)\b|\b(?:can|could|may|might|should|shall) (?:i|we)\b|\bhow (?:can|could|do|would|should|might) (?:i|we)\b|\bis it possible (?:for (?:me|us) )?to\b|\blet['’]?s\b)`;
/** Someone else doing it: "Why did Northwind hire him?", "Would a startup hire him?". */
const NOT_THEIRS = String.raw`(?<!\b(?:did|does|had|has|have|would|will|should|might)\s+(?!(?:i|we|you)\b)(?:[\w'’-]+\s+){1,2})`;

/**
 * Wanting to hire, interview, work with or reach him, asking for a quote, or
 * "how do we start" (visitor plan V6), English and German. Each pattern needs
 * the visitor's own intent (I, we, us) or him as its object, and not as
 * someone else's ("Why did Northwind hire him?"), so a question about what he
 * did stays ordinary: "Did he hire engineers?", "Has he hired or led a team?",
 * "Who did he work with?", "What's it like to work with him?", "contract
 * testing", "How does he handle client contracts?" (a careful question, not a
 * request), "Can you quote his post?", a project named after a contact form.
 * The flagged forms and the near misses are tests (router.spec.ts).
 */
const CONTACT_PATTERNS: RegExp[] = [
  // Hiring him, or the visitor hiring.
  new RegExp(
    String.raw`${NOT_THEIRS}\b(?:hire|hiring|recruit|recruiting|employ|engage|book|onboard)\s+${HIM}\b`,
    "i",
  ),
  new RegExp(String.raw`${WANT}[^.?!\n]{0,20}\b(?:hire|hiring|recruit|recruiting)\b`, "i"),
  /\bwe(?:['’]re| are) (?:hiring|recruiting)\b/i,
  /\b(?:available|open) for hire\b/i,
  /\b(?:join(?:ing)?|work(?:ing)? for) (?:us|our (?:team|company|startup|project))\b/i,
  // Reaching him, or sending him something.
  new RegExp(
    String.raw`${NOT_THEIRS}\b(?:contact|reach|email|e-mail)\s+${HIM}\b(?!\s+(?:back|later)\b)`,
    "i",
  ),
  new RegExp(String.raw`${NOT_THEIRS}\b(?:call|message|phone)\s+${ONLY_HIM}\b`, "i"),
  new RegExp(
    String.raw`${NOT_THEIRS}\b(?:send|forward|pass)\s+${ONLY_HIM}\s+(?:my|our|a|an|the|this)\b`,
    "i",
  ),
  new RegExp(String.raw`\bget (?:in touch|in contact|hold of) with ${HIM}\b`, "i"),
  /\b(?:i|we)\b[^.?!\n]{0,25}\bget (?:in touch|in contact|hold of)\b/i,
  new RegExp(String.raw`${NOT_THEIRS}\b(?:talk|speak) (?:to|with) ${ONLY_HIM}\b`, "i"),
  // Interviewing him, or meeting him.
  new RegExp(String.raw`${NOT_THEIRS}\binterview(?:ing)? ${HIM}\b`, "i"),
  new RegExp(
    String.raw`\b(?:schedule|set up|arrange|book)\b[^.?!\n]{0,20}\b(?:call|interview|meeting|chat)\b[^.?!\n]{0,12}\bwith ${HIM}\b`,
    "i",
  ),
  // Working with him: the visitor's wish, not what working with him is like.
  new RegExp(
    String.raw`${WANT}[^.?!\n]{0,25}\b(?:work|collaborate|partner|team up)(?:ing)? (?:together )?with ${HIM}\b`,
    "i",
  ),
  new RegExp(String.raw`${WANT}[^.?!\n]{0,25}\bwork together\b`, "i"),
  /\b(?:i|we) (?:have|['’]ve got|got) (?:a|an) (?:project|role|position|job|opening|opportunity|contract|gig) (?:for|that)\b/i,
  // A quote, asked for with its article ("Can you quote his post?" is no request), not one he gave.
  /\b(?:get|give|send|prepare|request|need|want|like|ask for|have)\b[^.?!\n]{0,15}\ba quote\b(?!\s+(?:from|by|in|about|of|on)\b)/i,
  /\b(?:get|give|send|prepare|request|need|want|like|ask for|have)\b[^.?!\n]{0,15}\b(?:a|an) (?:quotation|cost estimate|price estimate)\b/i,
  // "How do we start?", alone: "How do we start a RAG project?" is a question of method.
  /\bhow (?:do|can|should|would|could) (?:we|i) (?:get )?(?:start|begin|proceed|get started|move forward)\s*(?:with (?:him|you|alireza)\s*)?(?:[?.!]|$)/im,
  /\bwhat (?:are|['’]re) the next steps\b/i,
  // German: einstellen, beauftragen, Kontakt aufnehmen, zusammenarbeiten, ein Angebot.
  new RegExp(
    String.raw`\b${IHN} (?:[^\s.?!]+ ){0,2}(?:einstellen|anstellen|engagieren|buchen|beauftragen|rekrutieren|kontaktieren|erreichen|anrufen|anschreiben|interviewen)\b`,
    "i",
  ),
  /\b(?:schick|send|leit)\w* (?:ihm|alireza) (?:mein|unser|ein|den|die|das)\w*\b/i,
  new RegExp(String.raw`\b(?:kontaktier|erreich|schreib|ruf|sprech)\w* (?:ich|wir) ${IHN}\b`, "i"),
  new RegExp(
    String.raw`\b${ICH}\b[^.?!\n]{0,40}\b(?:einstellen|anstellen|engagieren|beauftragen)\b`,
    "i",
  ),
  /\bkontakt (?:zu (?:ihm|alireza) )?(?:aufnehmen|herstellen)\b/i,
  /\bmit (?:ihm|alireza|dir) (?:in )?kontakt\b/i,
  /\bmit (?:ihm|alireza|dir) (?:zusammenarbeiten|arbeiten|sprechen|reden|telefonieren)\b/i,
  new RegExp(String.raw`\b${ICH}\b[^.?!\n]{0,40}\bzusammenarbeiten\b`, "i"),
  /\b(?:vorstellungsgespräch|bewerbungsgespräch|kennenlerngespräch|interview)\b[^.?!\n]{0,30}\bmit (?:ihm|alireza|dir)\b/i,
  new RegExp(
    String.raw`\b${ICH}\b[^.?!\n]{0,40}\b(?:ein|einen) (?:angebot|kostenvoranschlag)\b`,
    "i",
  ),
  /\b(?:ich|wir) (?:habe|haben|hätte|hätten) (?:ein|eine|einen) (?:projekt|stelle|position|rolle|auftrag|anfrage) für (?:ihn|alireza|dich)\b/i,
  /\bwie (?:fangen|starten|beginnen|legen) wir (?:an|los)?\s*(?:[?.!]|$)/im,
  /\bwie geht es (?:jetzt |nun |dann )?weiter\s*(?:[?.!]|$)/im,
];

/** Whether the visitor's latest message asks to hire, interview, work with or reach him. */
export function contactIntentOf(text: string): "contact" | null {
  return CONTACT_PATTERNS.some((pattern) => pattern.test(text)) ? "contact" : null;
}

/** A short factual question: who, where, when, which; wer, wo, wann, welche. */
const LOOKUP_PATTERNS = [/^(?:who|where|when|which)\b/i, /^(?:wer|wo|wann|welche[mnrs]?)\b/i];
const LOOKUP_MAX_WORDS = 9;
/** A judgment, not a fact: "which would he pick", "when would he choose X over Y". */
const JUDGMENT = [
  /\b(would|should|could|might|better|best|worse|prefer\w*|choose|chose|pick|recommend\w*)\b/i,
  /\b(versus|vs|instead|over|würde|sollte|könnte|besser|lieber|wählen|empfehl\w*|statt)\b/i,
];

/** The newspaper test's topic, if the question touches one. */
export function sensitivityOf(text: string): Sensitivity | null {
  for (const [pattern, topic] of SENSITIVE_PATTERNS) if (pattern.test(text)) return topic;
  return null;
}

export function routeQuestion(
  text: string,
  options: {
    forceDeep: boolean;
    deepAllowed: boolean;
    projectNames: readonly string[];
    /** The case study the question was asked on (visitor plan V8): named, whatever it says. */
    pageProject?: string;
  },
): RouteDecision {
  const sensitive = sensitivityOf(text);
  const intent = contactIntentOf(text);
  const decide = (route: Route, reason: string): RouteDecision => ({
    ...(sensitive
      ? { route, reason: `${reason}+sensitive:${sensitive}`, sensitive }
      : { route, reason }),
    ...(intent ? { intent } : {}),
  });

  const deep = options.forceDeep
    ? "command"
    : deepReason(text, options.projectNames, options.pageProject);
  if (deep && options.deepAllowed) return decide("deep", deep);
  // The deep route is closed: a question it would take is still no lookup.
  if (deep) return decide("lite", deep === "command" ? "deep-off" : `${deep}+deep-off`);
  return withLookup(decide("lite", "default"), text);
}

/**
 * Why the question wants the deep model, or null: its words, or two projects
 * named. The page's project counts as named (visitor plan V8), so "Is this
 * like Borealis?" on Atlas's case study spans two.
 */
function deepReason(
  text: string,
  projectNames: readonly string[],
  pageProject?: string,
): string | null {
  for (const [pattern, reason] of DEEP_PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  const lower = text.toLowerCase();
  const named = projectNames.filter(
    (name) => name.length > 2 && lower.includes(name.toLowerCase()),
  );
  if (pageProject) named.push(pageProject);
  return new Set(named.map((n) => n.toLowerCase())).size >= 2 ? "multi-project" : null;
}

/**
 * The lookup tier, for a short plain question on the lite route; never a
 * sensitive one, nor one that asks for a judgment.
 */
function withLookup(decision: RouteDecision, text: string): RouteDecision {
  const question = text.trim();
  if (decision.sensitive || question.split(/\s+/).length > LOOKUP_MAX_WORDS) return decision;
  if (!LOOKUP_PATTERNS.some((pattern) => pattern.test(question))) return decision;
  if (JUDGMENT.some((pattern) => pattern.test(question))) return decision;
  return { ...decision, reason: `${decision.reason}+lookup`, lookup: true };
}

/** Why an answer routed lite moved to the deep chain mid-way. */
export type Escalation = "projects-fetched" | "search-spans-projects";

/** The logged route of an answer that moved up mid-way (`ai_messages.route`). */
export const ESCALATED_ROUTE = "lite→deep";

/** A finished step's tool results, as the agent's `prepareStep` sees them. */
export interface StepToolResults {
  toolResults: readonly { toolName: string; output: unknown }[];
}

/** A project's id without its language: both versions are one project. */
function projectOf(id: unknown): string | null {
  return typeof id === "string" ? (/^project:[^@\s]+/.exec(id)?.[0] ?? null) : null;
}

/**
 * Whether an answer turned out harder than its route: the steps so far
 * fetched two projects, or one search's two best hits are two projects (a
 * weaker match further down is often boilerplate every project shares, such
 * as its "Role:" line). The first that held, in step order; null while
 * neither has.
 */
export function escalationOf(steps: readonly StepToolResults[]): Escalation | null {
  const fetched = new Set<string>();
  for (const result of steps.flatMap((step) => step.toolResults)) {
    const reason = escalationAfter(result, fetched);
    if (reason) return reason;
  }
  return null;
}

/** Whether one tool result tips the answer over; a fetched project joins `fetched`. */
function escalationAfter(
  { toolName, output }: StepToolResults["toolResults"][number],
  fetched: Set<string>,
): Escalation | null {
  const result = (output ?? {}) as { id?: unknown; results?: unknown };
  if (toolName === "get_document") {
    const project = projectOf(result.id);
    if (project) fetched.add(project);
    return fetched.size >= 2 ? "projects-fetched" : null;
  }
  if (toolName !== "search_portfolio" || !Array.isArray(result.results)) return null;
  const [first, second] = (result.results as ({ id?: unknown } | null)[]).map((hit) =>
    projectOf(hit?.id),
  );
  return first && second && first !== second ? "search-spans-projects" : null;
}

/** What an eval case may expect of the routing (`expectRoute`, evals/cases.ts). */
export type RouteLabel = Route | typeof ESCALATED_ROUTE | "lookup" | "sensitive";

/**
 * The labels an answer's routing earned: the router's route, `lite→deep` when
 * it moved up mid-way, and lookup or sensitive. A case that expects `lite`
 * tests the router, so an answer that later moved up still meets it.
 */
export function routeLabels(decision: RouteDecision, escalated: boolean): RouteLabel[] {
  const labels: RouteLabel[] = [decision.route];
  if (escalated) labels.push(ESCALATED_ROUTE);
  if (decision.lookup) labels.push("lookup");
  if (decision.sensitive) labels.push("sensitive");
  return labels;
}
