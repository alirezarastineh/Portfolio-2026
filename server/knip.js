// knip (plan Phase 9, advisory in CI): unused files, exports and dependencies.
// Beside src/index.ts, a default entry: the CLIs run by path (package.json
// scripts, the Dockerfile, the runbooks), and CI runs scripts/*.mjs by name.
export default {
  entry: ["src/**/*-cli.ts", "src/scripts/*.ts", "scripts/*.mjs"],
  project: ["src/**/*.ts", "scripts/*.mjs"],
  // Run as a command (CI's format step, /verify), never imported.
  ignoreDependencies: ["prettier"],
};
