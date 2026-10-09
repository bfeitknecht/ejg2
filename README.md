# ejg2.com

A hand-built, fully self-contained static site for [www.ejg2.com](https://www.ejg2.com).
No site builder, no framework runtime in the browser — just static HTML rendered at
build time with [Preact](https://preactjs.com) (via `htm` templates) on
[Deno](https://deno.com), one small client island for the contact form, and a single
hand-written stylesheet.

## Project layout

```
deno.json                 tasks + dependencies (preact, htm, esbuild, linkedom)
src/
  content/                the site's content as typed JSON (committed source of truth)
    site.json             global config: nav, contact info, form endpoint
    pages/*.json          one file per page (typed content blocks)
    assets-manifest.json  maps each referenced asset to its source file
  components/             Preact components (htm templates): layout, blocks, pages, form
  islands/contact-form.ts the one client-side island (AJAX form + homepage modal)
  styles.css              the whole design, hand-written
tools/
  extract.ts              one-time migration: legacy Squarespace export -> content JSON
  build.tsx               static site generator: renders pages, copies assets, bundles island
  serve.ts                local preview server
  check.ts                verifies every reference resolves + no third-party CDN refs
css/ js/ img/ files/      build output (committed, so the branch is deployable as-is)
```

## Tasks

```sh
deno task build   # render all pages + copy assets + bundle the form island
deno task check   # verify references, GitHub Pages files, no CDN dependencies
deno task serve   # local preview at http://127.0.0.1:8000/
deno task extract # one-time migration from the legacy export in .legacy/ (not needed normally)
```

Content lives in `src/content/` — edit the JSON, run `deno task build`, commit.
The build is fully offline; nothing is fetched at build time.

## Deploying (GitHub Pages)

1. Push this repo to GitHub (branch `main`).
2. Repo **Settings → Pages** → Source: **Deploy from a branch** → `main` → `/ (root)`.
3. Done — the site is live at `https://<username>.github.io/<repo>/` immediately.
   All paths are relative, so the preview works fully styled without any DNS.
4. Later, when the client signs off and you switch DNS to `www.ejg2.com`: add a
   `CNAME` file containing `www.ejg2.com` (the build no longer emits one), enter
   the domain in **Settings → Pages**, point DNS (table below), wait for the
   check, then **Enforce HTTPS**.

## DNS records

At the domain's DNS provider, remove the old site-builder records and add:

| Type  | Name | Value                   |
| ----- | ---- | ----------------------- |
| CNAME | www  | `<username>.github.io.` |
| A     | @    | 185.199.108.153         |
| A     | @    | 185.199.109.153         |
| A     | @    | 185.199.110.153         |
| A     | @    | 185.199.111.153         |
| AAAA  | @    | 2606:50c0:8000::153     |
| AAAA  | @    | 2606:50c0:8001::153     |
| AAAA  | @    | 2606:50c0:8002::153     |
| AAAA  | @    | 2606:50c0:8003::153     |

Optional domain verification (unlocks HTTPS for the apex too):

| Type | Name                                          | Value                          |
| ---- | --------------------------------------------- | ------------------------------ |
| TXT  | `_github-pages-challenge-<username>.ejg2.com` | `<code from Settings → Pages>` |

The `CNAME` file pins the canonical host to `www.ejg2.com`; once the apex records
point at GitHub, `ejg2.com` 301-redirects there.

## Contact form

The form on `/contact/` (and the homepage modal) submits through
[FormSubmit.co](https://formsubmit.co) to `e@ejg2.com` — no account needed, but the
**very first submission** sends a one-time activation email that must be confirmed.
Without JavaScript the form falls back to a native POST to the same service.

To use a different backend (e.g. Formspree), change `formEndpoint` in
`src/content/site.json` and rebuild.

## Notes

- **URLs changed** in the rebuild: `/miscellaneous/` → `/contact/`, `/main/` → `/`,
  `/ejg2-projects/…` → `/projects/…`, `/ejg2-blog/…` → `/blog/…`. Old URLs redirect
  client-side via `404.html`.
- **Fonts** are a system font stack — no webfont services, nothing external.
- **Video** embeds use youtube-nocookie.com; everything else is served from this
  repo. `deno task check` fails if any third-party CDN reference creeps back in.
- The legacy Squarespace export used for the one-time migration is kept in
  `.legacy/` (gitignored) for reference only — nothing depends on it.
