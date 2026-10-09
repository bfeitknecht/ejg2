#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net
/**
 * Static site generator for ejg2.com.
 *
 * Renders src/content/*.json through the Preact components in src/ into plain
 * HTML at the repo root (GitHub Pages deploys from here), copies referenced
 * assets out of the legacy mirror, bundles the contact-form island with esbuild,
 * and emits the GitHub Pages config files.
 *
 * Usage: deno task build
 */

import esbuild from "esbuild";
import { render } from "preact-render-to-string";
import { loadPages, loadSite, type PageContent } from "../src/content.ts";
import { Layout } from "../src/components/Layout.ts";
import { ListingPage, PageRenderer } from "../src/components/pages.ts";
import { html } from "../src/html.ts";

const ROOT = new URL("../", import.meta.url).pathname;
const LEGACY = new URL("../.legacy/", import.meta.url).pathname;

const FINAL_HOST = "www.ejg2.com";

async function writeText(rel: string, text: string) {
  const p = ROOT + rel;
  await Deno.mkdir(p.slice(0, p.lastIndexOf("/")), { recursive: true });
  await Deno.writeTextFile(p, text);
}

async function copyAsset(legacyRel: string, dest: string): Promise<boolean> {
  const src = LEGACY + legacyRel;
  try {
    const bytes = await Deno.readFile(src);
    const out = ROOT + dest;
    await Deno.mkdir(out.slice(0, out.lastIndexOf("/")), { recursive: true });
    await Deno.writeFile(out, bytes);
    return true;
  } catch {
    console.warn(`  missing legacy asset: ${legacyRel}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Render pages
// ---------------------------------------------------------------------------

const site = await loadSite();
const extracted = await loadPages();

interface Built {
  path: string;
  title: string;
  description: string;
}

const built: Built[] = [];

/** Rewrite root-absolute refs to paths relative to the page's depth, so the
 *  built site works at any base URL (github.io project preview AND the root
 *  custom domain). Canonical/og URLs stay absolute on purpose. */
function relativize(doc: string, depth: number): string {
  const prefix = "../".repeat(depth);
  const home = prefix === "" ? "./" : prefix;
  return doc
    .replace(
      /(src|href|poster)="\/((?:img|files|css|js)\/)/g,
      (m, attr, dir) => `${attr}="${prefix}${dir}`,
    )
    .replace(
      /(src|href|poster)='\/((?:img|files|css|js)\/)/g,
      (m, attr, dir) => `${attr}='${prefix}${dir}`,
    )
    .replace(
      /url\((['"])\/((?:img|files|css|js)\/)/g,
      (m, q, dir) => `url(${q}${prefix}${dir}`,
    )
    .replace(/href="\/"/g, `href="${home}"`)
    .replace(/href="\/([a-z0-9-]+\/)/g, (m, seg) => `href="${prefix}${seg}`);
}

function renderPage(page: PageContent) {
  const depth = page.path.split("/").filter(Boolean).length;
  const doc = relativize(
    "<!doctype html>\n" +
      render(html`<${PageRenderer} site=${site} page=${page} />`),
    depth,
  );
  const file = page.path === "/"
    ? "index.html"
    : page.path.replace(/^\/|\/$/g, "") + "/index.html";
  return writeText(file, doc).then(() => {
    built.push({
      path: page.path,
      title: page.title,
      description: page.description,
    });
    console.log(`  ${page.path}`);
  });
}

console.log("Rendering pages:");
for (const page of extracted) {
  await renderPage(page);
}

// Listing pages generated from post data (the legacy ones were dynamic).
const projectPosts = extracted.filter((p) =>
  p.layout === "post" && p.path.startsWith("/projects/")
);
const blogPosts = extracted.filter((p) =>
  p.layout === "post" && p.path.startsWith("/blog/")
);

const generated: PageContent[] = [
  {
    path: "/projects/",
    title: "Projects",
    description: "Selected projects — print, digital, web and social.",
    layout: "hub",
  },
  {
    path: "/blog/",
    title: "Blog",
    description: "Occasional notes from EJG2.",
    layout: "hub",
  },
];

console.log("Rendering generated listings:");
{
  const projectsDesc = "Selected projects — print, digital, web and social.";
  const doc = relativize(
    "<!doctype html>\n" + render(
      html`
        <${ListingPage}
          site=${site}
          path="/projects/"
          title="Projects"
          description=${projectsDesc}
          posts=${projectPosts}
          backLabel="Work"
          backHref="/work/"
        />
      `,
    ),
    1,
  );
  await writeText("projects/index.html", doc);
  built.push({
    path: "/projects/",
    title: "Projects",
    description: projectsDesc,
  });
  console.log("  /projects/");
}
{
  const blogDesc = "Occasional notes from EJG2.";
  const doc = relativize(
    "<!doctype html>\n" + render(
      html`
        <${ListingPage}
          site=${site}
          path="/blog/"
          title="Blog"
          description=${blogDesc}
          posts=${blogPosts}
        />
      `,
    ),
    1,
  );
  await writeText("blog/index.html", doc);
  built.push({ path: "/blog/", title: "Blog", description: blogDesc });
  console.log("  /blog/");
}
void generated;

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

console.log("Copying assets:");
const manifest = JSON.parse(
  await Deno.readTextFile(
    new URL("../src/content/assets-manifest.json", import.meta.url).pathname,
  ),
) as Record<string, { legacy: string; dest: string }>;

let copied = 0;
for (const entry of Object.values(manifest)) {
  if (await copyAsset(entry.legacy, entry.dest)) copied++;
}
console.log(`  ${copied}/${Object.keys(manifest).length} assets copied`);

await Deno.mkdir(ROOT + "css", { recursive: true });
await Deno.copyFile(
  new URL("../src/styles.css", import.meta.url).pathname,
  ROOT + "css/site.css",
);

console.log("Bundling contact-form island:");
await esbuild.build({
  entryPoints: [
    new URL("../src/islands/contact-form.ts", import.meta.url).pathname,
  ],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2019",
  outfile: ROOT + "js/contact-form.js",
  logLevel: "warning",
});
await esbuild.stop();
console.log("  js/contact-form.js");

// ---------------------------------------------------------------------------
// GitHub Pages config
// ---------------------------------------------------------------------------

const allPaths = built.map((b) => b.path);

await writeText(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${
    allPaths.map((p) => `  <url><loc>https://${FINAL_HOST}${p}</loc></url>`)
      .join("\n")
  }
</urlset>
`,
);

await writeText(
  "robots.txt",
  `User-agent: *\nAllow: /\n\nSitemap: https://${FINAL_HOST}/sitemap.xml\n`,
);

// No CNAME on purpose: the site previews at <user>.github.io/<repo>/ first.
// When switching DNS to www.ejg2.com, add a CNAME file containing that domain
// (or enter the domain in Settings → Pages).
await writeText(".nojekyll", "");

// 404 page with client-side redirects for URLs that changed in the rebuild.
const REDIRECTS: Record<string, string> = {
  "/main": "/",
  "/main/": "/",
  "/miscellaneous": "/contact/",
  "/miscellaneous/": "/contact/",
  "/ejg2-projects": "/projects/",
  "/ejg2-projects/": "/projects/",
  "/ejg2-blog": "/blog/",
  "/ejg2-blog/": "/blog/",
  "/ejg2-projects/2021/7/13/i-was-an-anti-abortion-leader/":
    "/projects/i-was-an-anti-abortion-leader/",
  "/ejg2-projects/2021/7/13/in-conversation-with-frank-schaeffer/":
    "/projects/in-conversation-with-frank-schaeffer/",
  "/ejg2-projects/2023/1/19/love-in-common/": "/projects/love-in-common/",
  "/ejg2-blog/2019/2/22/oscars-2019/": "/blog/oscars-2019/",
};

// 404.html is served at the URL that 404'd, so relative refs would resolve
// against an unknown depth. Keep refs root-absolute and detect the site base
// at runtime (works both on username.github.io/<repo>/ and on the custom
// domain), with inline styles so the page never renders unstyled.
const notFoundNav = site.nav.map((n) =>
  `<a data-root href="${n.href}">${n.label}</a>`
)
  .join(" · ");
await writeText(
  "404.html",
  `<!doctype html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found — EJG2</title>
<style>
body{margin:0;background:#fbfaf7;color:#22211f;line-height:1.65;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:46rem;margin:0 auto;padding:4rem 1.25rem}
h1{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;font-size:2rem;line-height:1.2;margin:0 0 1rem}
a{color:#c74a32}.links a{margin-right:.75rem}.back{margin-top:2rem}
</style>
<script>
(function () {
  var REDIRECTS = ${JSON.stringify(REDIRECTS)};
  function finish(base) {
    var path = location.pathname.replace(/\\/+$/, "/");
    var target = REDIRECTS[path];
    if (!target && /^\\/ejg2-projects\\//.test(path)) target = "/projects/";
    if (!target && /^\\/ejg2-blog\\//.test(path)) target = "/blog/";
    if (target) { location.replace(base + target); return; }
    var links = document.querySelectorAll("a[data-root]");
    for (var i = 0; i < links.length; i++) {
      links[i].setAttribute("href", base + links[i].getAttribute("href"));
    }
  }
  // On project previews the site lives under /<repo>/; probe for it.
  var seg = location.pathname.split("/")[1] || "";
  if (seg && seg !== "css" && seg !== "js" && seg !== "img" && seg !== "files") {
    fetch(seg + "/css/site.css", { method: "HEAD" }).then(function (r) {
      finish(r.ok ? "/" + seg : "");
    }).catch(function () { finish(""); });
  } else {
    finish("");
  }
})();
</script>
</head>
<body>
<main>
  <article>
    <h1>Page not found</h1>
    <p>The page you are looking for does not exist (or moved). Try one of these:</p>
    <p class="links">${notFoundNav}</p>
    <p class="back"><a data-root href="/">← Home</a></p>
  </article>
</main>
</body>
</html>
`,
);

console.log(
  `\nDone: ${built.length + 2} pages, ${copied} assets. Output: ${ROOT}`,
);
