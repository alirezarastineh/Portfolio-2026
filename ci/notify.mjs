// Emails the owner that a workflow failed (plan Phase 13), through Resend's
// API. Every workflow ends with an `email` step that runs this on a failure,
// for pushes to main, cron runs and deployments, and for a manual run with
// NOTIFY_TEST=1. One step per workflow, not a notify workflow after all the
// others: Woodpecker 3.19 skips a workflow that runs on failure as soon as any
// of its dependencies passed (server/model/task.go, ShouldRun).
//
// Usage: node ci/notify.mjs [--dry-run]
// Reads RESEND_API_KEY and ALERT_TO (secrets) and Woodpecker's CI_* variables.
// --dry-run prints the email instead of sending it, and needs no secrets.
const env = process.env;
const dryRun = process.argv.includes("--dry-run");

const workflow = env.CI_WORKFLOW_NAME || "a workflow";
const pipeline = env.CI_PIPELINE_NUMBER || "?";
const sha = (env.CI_COMMIT_SHA || "").slice(0, 7);
const branch = env.CI_COMMIT_BRANCH || "?";
const pipelineEvent = env.CI_PIPELINE_EVENT || "?";
/** What started the pipeline, in a few words. */
function describeRun() {
  if (pipelineEvent === "deployment")
    return `deployment to ${env.CI_PIPELINE_DEPLOY_TARGET || "?"}`;
  if (pipelineEvent === "manual" && env.NOTIFY_TEST === "1")
    return "manual run, NOTIFY_TEST";
  return pipelineEvent;
}
const run = describeRun();
const title = (env.CI_COMMIT_MESSAGE || "").split("\n")[0];

const subject = `[CI] ${workflow} failed on ${branch} (${run}, ${sha})`;
const text = [
  `${workflow} failed in pipeline #${pipeline} (${run}).`,
  "",
  `Commit: ${sha} ${title}`,
  `Author: ${env.CI_COMMIT_AUTHOR || "?"}`,
  `Pipeline: ${env.CI_PIPELINE_URL || "?"}`,
  `On GitHub: ${env.CI_PIPELINE_FORGE_URL || "?"}`,
  "",
  "The failing step's log is in the pipeline. The workflows that keep reports save them under",
  `\\\\wsl.localhost\\Ubuntu\\srv\\ci-reports\\${pipeline}.`,
].join("\n");
const email = {
  from: "Woodpecker CI <ci@alirezarastineh.me>",
  to: [env.ALERT_TO],
  subject,
  text,
};

if (dryRun) {
  console.log(JSON.stringify({ ...email, to: ["<alert_to>"] }, null, 2));
  process.exit(0);
}
if (!env.RESEND_API_KEY || !env.ALERT_TO) {
  console.error("notify: the resend_api_key and alert_to secrets are required");
  process.exit(1);
}

const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    authorization: `Bearer ${env.RESEND_API_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify(email),
  signal: AbortSignal.timeout(30_000),
});
const body = await response.text();
if (!response.ok) {
  console.error(`notify: Resend answered ${response.status}: ${body}`);
  process.exit(1);
}
console.log(`notify: sent "${subject}" (${JSON.parse(body).id})`);
