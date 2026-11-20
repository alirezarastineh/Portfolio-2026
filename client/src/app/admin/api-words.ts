/**
 * Every code the admin's API calls can answer with, in words: what happened, and what to do next
 * (plan 5, U19: no raw code reaches a toast). An area's own map says more where a code means more
 * there (a proposal's `not_found` is "That proposal is gone.") and falls back to this one. The
 * visitors' own codes (Turnstile, a busy stream) never reach the admin and are not here.
 */
const WORDS: ReadonlyMap<string, string> = new Map(
  Object.entries({
    // The request itself (`admin-api.service.ts` names these).
    network_error: "The API did not answer: check the connection, then try again.",
    request_failed: "The request failed: try again.",
    upload_failed: "The upload failed: try again.",
    internal_error: "The server failed: try again; its log says why.",
    // The session and signing in.
    unauthenticated: "You were signed out: sign in, then try again.",
    totp_required: "The sign-in needs its code: sign in again, then try again.",
    csrf_invalid: "Your session expired mid-request: reload the page and try again.",
    origin_rejected: "This address may not sign in: check ADMIN_ORIGIN on the server.",
    invalid_credentials: "Incorrect email or password.",
    invalid_code: "That code was not accepted: try the next one, or a recovery code.",
    rate_limited: "Too many attempts: wait a few minutes, then try again.",
    no_pending_totp: "No sign-in is waiting for a code: start again with the email and password.",
    no_pending_enrolment: "No two-step setup is waiting: start it again in Account.",
    // What was sent.
    invalid_input: "Something in it is missing or out of bounds: check the fields, then try again.",
    invalid_id: "That id is not valid: reload the page, then try again.",
    not_found:
      "It is gone: deleted meanwhile, here or in another tab. Reload to see what is there.",
    stale:
      "It was saved elsewhere meanwhile: reload to get that version, then make your change again.",
    unsupported_locale: "The site has no such language.",
    unknown_section: "This API does not know that yet: deploy the API first.",
    unknown_kind: "This API does not know that yet: deploy the API first.",
    unknown_ids: "Some items were deleted meanwhile: reload the list, then try again.",
    duplicate_ids: "The list named an item twice: reload it, then try again.",
    duplicate: "Another item already has that id: choose another.",
    duplicate_id: "Another item already has that id: choose another.",
    duplicate_slug: "Another entry already has that address: choose another slug.",
    id_immutable: "An id cannot change once saved: add a new item instead.",
    // Content, publishing and media.
    invalid_media: "A chosen file is not the kind this field takes.",
    invalid_draft: "The draft has problems: fix them, then publish again.",
    publish_failed: "The server could not build the site, so nothing went live: try again.",
    media_missing: "A file it shows was deleted from the media library.",
    invalid_payload: "It no longer matches the current content format.",
    incomplete_publication:
      "That older publication holds one language only, so it cannot be restored.",
    media_in_use: "The draft uses it now: change those places first.",
    media_in_use_live: "The live site shows it now: publish without it first.",
    media_in_history: "An older publication shows it, so a rollback could need it.",
    file_too_large: "That file is over 10 MB. Compress it and try again.",
    image_too_large: "That image is over 50 megapixels. Scale it down and try again.",
    unsupported_media_type: "Only PNG, JPEG, WebP, AVIF, GIF and PDF are accepted.",
    missing_file: "No file was received.",
    invalid_upload: "The upload could not be read.",
    not_an_image: "That file is not an image.",
    unreadable: "The server could not read the image file.",
    // What may spend (`guard.ts refusal`), and the models.
    feature_off: "This feature is switched off: Settings, under Spending.",
    assistant_off: "The assistant is off on this server, or has no model.",
    assistant_resting: "Today's budget is spent: it starts again at midnight UTC.",
    budget_exhausted: "Today's budget is spent: it starts again at midnight UTC.",
    reserve_reached: "Today's spend reached the reserve line: the rest is kept for visitors.",
    cap_reached: "This feature reached its own daily cap.",
    already_running: "Another paid run is going: try once it ends.",
    unavailable: "No model of the chain answered: try again later.",
    no_chain: "No model is set up for this in the deploy.",
    no_model_for_this: "No model in the deploy can do this (an image needs one that reads images).",
    no_gemini_key: "The deploy has no Gemini key.",
    count_failed: "Gemini did not count the tokens: try again later.",
    empty_draft: "Every draft came back empty (a safety filter, maybe): write it by hand.",
    too_long: "The question is too long: at most 2,000 characters.",
    // Runs.
    not_cancellable: "That run has ended: there is nothing to cancel.",
    not_resumable: "Only a failed, interrupted or cancelled run can be resumed.",
    no_cases: "None of the chosen eval cases exists any more.",
    same_answerer: "Pick two different answerers to compare.",
    unknown_answerer: "The deploy has no answerer by that name.",
    no_visitor_judge: "No judge model answers visitors, so none may read their answers.",
    nothing_to_judge: "Nothing to judge: every reviewed answer has its verdict.",
    failed: "It failed on the server and nothing was written: try again.",
    nothing_to_do: "Nothing to draft: the content has no gaps for these goals.",
    // Trust and the corpus.
    already_checking: "A trust check is running already: wait for it.",
    remote_database: "The check runs on the server only, never against the tunnelled database.",
    not_demoted: "That is in service already.",
    not_demotable: "That document is always read first: it cannot be moved down.",
    both_tiers: "A document cannot be raised and lowered at once.",
    already_journaled: "This answer has a journal entry already: open it in the Journal.",
    // The journal, lessons, FAQ proposals and the content agent (their own maps say more).
    bad_transition: "It cannot move there from where it is now: reload, then try again.",
    missing_root_cause: "Write the root cause first.",
    vague_heuristic: "The heuristic is too short: say when it applies, and why.",
    missing_fix: "Name the fix or freeze a regression case first.",
    unknown_case: "That eval case does not exist.",
    unknown_document: "No document with that id was in the answer's corpus.",
    corpus_unavailable: "Neither the answer's corpus nor today's could be read.",
    answer_gone: "The answer is gone, deleted by the visitor or pruned: no question is left.",
    not_replayable: "A fixed or retired entry is not replayed.",
    no_snapshot: "This answer's corpus has no snapshot, so it cannot be re-run as it was.",
    question_gone: "The answer was pruned (after 90 days): no question is left to draft from.",
    unknown_topic: "That insights run is gone (runs are kept under 60 days): run insights again.",
    unknown_entry: "That journal entry was deleted meanwhile.",
    unknown_lesson: "That lesson was deleted meanwhile.",
    lesson_elsewhere: "That lesson is about something else.",
    lesson_applied: "That lesson was applied meanwhile: pick another, or a new one.",
    lesson_retired: "That lesson was retired: pick another, or a new one.",
    not_corroborated: "Not corroborated yet.",
    vague_statement: "Write the lesson as a rule someone can follow.",
    empty_scope: "Name at least one word of 3 letters or more that its questions contain.",
    instruction: "It reads as an instruction to the assistant: rewrite it.",
    not_open: "It was decided already, here or in another tab.",
    no_text: "There is no draft: edit it and write the text first.",
    not_applied: "Only an applied proposal can be reverted.",
    changed_since: "Its field changed since it was applied: change it in its editor.",
  }),
);

/** A code in words. One it does not know gets a plain sentence, never the code. */
export function apiWords(code: string): string {
  const words = WORDS.get(code);
  if (words) {
    return words;
  }
  const status = /^http_(\d{3})$/.exec(code)?.[1];
  if (status?.startsWith("5")) {
    return `The API failed (HTTP ${status}): try again; its log says why.`;
  }
  if (status === "404") {
    return "This API does not have that yet: deploy the API first.";
  }
  if (status) {
    return "The API refused the request: reload the page and try again.";
  }
  return "The server refused this. Try again; if it happens again, its log says why.";
}
