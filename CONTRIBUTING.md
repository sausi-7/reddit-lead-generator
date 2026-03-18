# Contributing to Reddit Lead Generator

Thanks for taking the time to contribute. Here's everything you need to get started.

---

## Table of contents

- [Getting started](#getting-started)
- [How to contribute](#how-to-contribute)
- [What to work on](#what-to-work-on)
- [Code style](#code-style)
- [Submitting a pull request](#submitting-a-pull-request)
- [Reporting bugs](#reporting-bugs)

---

## Getting started

1. Fork the repo and clone your fork:
   ```bash
   git clone https://github.com/your-username/reddit-lead-generator.git
   cd reddit-lead-generator
   npm install
   ```

2. Copy `.env.example` to `.env` and add at least one AI provider key:
   ```bash
   cp .env.example .env
   ```

3. Start the dev server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) — you're ready.

---

## How to contribute

- **Bug fixes** — open an issue first if it's non-trivial so we can discuss the approach.
- **New features** — check the [open issues](../../issues) or the ideas list below. Comment on the issue before starting to avoid duplicate work.
- **Docs** — typos, clarity improvements, and missing details are always welcome.

---

## What to work on

Good first issues are labeled [`good first issue`](../../labels/good%20first%20issue). Some concrete ideas:

| Idea | Difficulty |
|---|---|
| Add `new` / `rising` / `top` sort modes for Reddit threads | Easy |
| Export results to CSV | Easy |
| Save and reload subreddit configurations (localStorage) | Easy |
| Add a "generate reply" button using AI | Medium |
| Support selecting Ollama models from a dropdown | Medium |
| Add pagination / load more threads | Medium |
| Dark/light theme toggle | Easy |

---

## Code style

- ES modules (`import`/`export`) throughout — no `require()`.
- No build step — keep the frontend as plain HTML/JS in `public/index.html`.
- Backend logic lives in `server.js`. Keep it readable; add a comment if something isn't obvious.
- Keep PRs focused — one feature or fix per PR.

---

## Submitting a pull request

1. Create a branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes. Verify the app still works end-to-end.

3. Push and open a PR against `main`. Fill out the PR template — it's short.

4. A maintainer will review within a few days. Be ready to address feedback.

---

## Reporting bugs

Use the [bug report template](../../issues/new?template=bug_report.md). Include:
- What you did
- What you expected
- What actually happened
- Your Node.js version and which AI provider(s) you have configured

---

## Questions?

Open a [discussion](../../discussions) or drop a comment on the relevant issue.
