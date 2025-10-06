# Repository Guidelines

## Project Structure & Module Organization
The Firebase project root hosts deployment configs: `firebase.json`, Firestore rules, and hosting assets under `public/`. Cloud Functions code lives in `functions/src`, compiled to `functions/lib` via TypeScript; key folders include `api/` (Express routes), `classification/` (LLM scoring utilities), `services/` (Firestore access), `workers/` (ingest pipelines), and `tags/` for content labeling. Shared helpers are in `utils/`, auth middleware in `middleware/`, and reusable models under `models/`. Emulator scripts sit in `scripts/`, while `terraform/` tracks infrastructure experiments.

## Build, Test, and Development Commands
Run `npm install` once in both the repo root and `functions/`. Use `npm run build` inside `functions/` to transpile to `lib/`; `npm run build:watch` keeps the compiler running during edits. Start local emulators with `npm run serve` (root) or `npm run serve` within `functions/` for functions-only development. Deploy functions via `npm run deploy` inside `functions/`, and `npm run logs` tails production logs. The ad-hoc classifier check can be executed with `node src/scripts/test-classifier.js --calendar sample`.

## Coding Style & Naming Conventions
Write strict TypeScript targeting Node 20; keep new source in `functions/src` and allow the compiler to emit JavaScript. Use two-space indentation, single quotes, and `camelCase` for variables/functions; reserve `PascalCase` for types/interfaces. Prefer small modules with explicit exports, and update barrel-like route registration via `api/routes.ts` when adding endpoints.

## Testing Guidelines
There is no dedicated test runner yet; rely on `npm run build` to catch type errors and use Firebase emulators for integration smoke tests. Construct fixture data in `functions/src/__fixtures__` and share reusable helpers instead of stubbing Firebase Admin manually. When adding automated tests, co-locate them next to the code and name files `<feature>.spec.ts`, ensuring they can run against the emulator without external network calls.

## Commit & Pull Request Guidelines
Commit messages should be present-tense and imperative (e.g., `Add calendar ingest chunking`), with concise scope descriptions under 72 characters. For pull requests, include a summary of functional impact, manual verification steps, and any relevant Firebase emulator output. Link issue IDs when available and attach screenshots or logs for UI or API contract changes.

## Security & Configuration Tips
Secrets `OPENAI_API_KEY` and `GOOGLE_CALENDAR_API_KEY` must be provisioned via `firebase functions:secrets:set`; do not commit `.env` files. Keep Firestore rules updated alongside schema changes, and note that emulator traffic defaults to `America/Los_Angeles` time zone—mirror this in tests to avoid flaky comparisons.
