# Contributing

Thanks for your interest! This repo is a **teaching starter** — its job is to make the fundamentals of
a LINE Official Account web app easy to *read and recreate*. That goal shapes what makes a good
contribution here, so please skim the principles below before opening a PR.

## Guiding principles

Contributions are most welcome when they keep the project **clear over clever**:

- **No `@line/bot-sdk`.** Every call to the LINE platform stays a visible `fetch` (or `node:crypto` for
  signatures). The whole point is that a reader can see exactly what happens on the wire.
- **Stay self-contained.** No hidden services. The app runs from this repo + Supabase alone; the schema
  lives in `supabase/migrations/`.
- **Readable beats minimal-diff.** A short comment explaining a LINE-specific quirk (why the raw body,
  why always-200, why verify the token) is worth more than saving a line.
- **Keep dependencies tiny.** Adding an npm dependency needs a good reason — prefer a few lines of
  plain code a learner can follow.
- **English, generic domain.** Docs and sample copy are in English; keep example data obviously fake
  and domain-neutral (no real org/brand/person data).
- **It's a starter, not a framework.** Resist feature creep. Improvements that make the existing
  fundamentals clearer or more correct are better than new subsystems.

## Great contributions

- Fixing bugs or correctness issues (especially in signature verification, the reminder date math, or
  the webhook dispatch).
- Clarifying docs, comments, or the README.
- Small, well-explained examples of a LINE feature that a newcomer commonly needs (e.g. a richer Flex
  sample, an imagemap, quick-reply patterns) — as an **opt-in** addition, not bolted onto the core path.
- Portability fixes (other deploy targets, other Postgres hosts).

Please **open an issue first** for anything larger than a bug fix or doc tweak, so we can agree it fits
the scope before you invest time.

## Development setup

```bash
git clone https://github.com/jjnnaappaatt/line-oa-nextjs-starter.git
cd line-oa-nextjs-starter
npm install
cp .env.example .env.local     # everything is optional at first — the app runs with nothing set
npm run dev                    # http://localhost:3000
```

To exercise the LINE integration end-to-end, follow [docs/LINE_SETUP.md](docs/LINE_SETUP.md) and apply
the schema in `supabase/migrations/`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the
pieces fit together.

## Before you open a PR

Run both — they must pass with no errors:

```bash
npm run typecheck    # tsc --noEmit
npm run build        # next build
```

Then:

- Keep the change focused; match the surrounding code style (2-space indent, existing naming, the
  comment density you see in `lib/line/*`).
- **Never commit secrets.** Real values go in `.env.local` (git-ignored); only `.env.example` (empty
  placeholders) is tracked. Don't paste tokens/keys into code, tests, issues, or PR descriptions.
- Update the relevant doc (`README.md` or a file under `docs/`) if you change behavior or add config.
- Write a clear PR description: what changed and why, and how you verified it.

## Reporting bugs & security

- **Bugs / ideas:** open a GitHub issue with steps to reproduce (and your Node/Next versions).
- **Security:** please **don't** file a public issue for a vulnerability. Report it privately via the
  repository's *Security* tab (Report a vulnerability). Never include real tokens or keys in a report.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE), the
same license that covers the project.
