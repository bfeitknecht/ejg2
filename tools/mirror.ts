#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
/**
 * Mirror www.ejg2.com into this repository as a static site for GitHub Pages.
 *
 * Usage: deno run --allow-net --allow-read --allow-write tools/mirror.ts
 *
 * What it does:
 *   1. Seeds the crawl from /sitemap.xml, then follows internal links.
 *   2. Saves each page as <path>/index.html (directory-style URLs).
 *   3. Downloads assets from Squarespace + Typekit CDNs into assets/<host>/...
 *      - Squarespace image renditions (?format=...) collapse into one 1500w file
 *        per image, since GitHub Pages ignores query strings anyway.
 *   4. Rewrites references in HTML/CSS/JS:
 *      - pages  -> relative paths (work at any base URL)
 *      - css    -> relative paths (url() resolves against the css file)
 *      - js     -> root-absolute paths (correct once the custom domain is attached;
 *                  the Typekit kit injects css relative to the document, so this is
 *                  the only safe option there)
 *      - og:image / twitter:image / image_src are re-absolutized against the
 *        final domain, because social crawlers require absolute URLs.
 *   5. Emits GitHub Pages config: CNAME, .nojekyll, robots.txt, sitemap.xml, 404.html.
 *
 * Deliberately left hotlinked:
 *   - JSON-escaped URLs inside inline Squarespace config (https:\/\/...) — rewriting
 *     them risks breaking Squarespace's runtime JS, and the public CDN keeps working.
 *   - googletagmanager.com, p.typekit.net (analytics/tracking), definitions.sqspcdn.com.
 *   - Any asset download that failed (logged below) stays pointed at the CDN.
 */

const ORIGIN = "https://www.ejg2.com";
const FINAL_HOST = "www.ejg2.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const LOCALIZE_HOSTS = new Set([
  "assets.squarespace.com",
  "static1.squarespace.com",
  "images.squarespace-cdn.com",
  "file.squarespace-cdn.com",
  // use.typekit.net is deliberately hotlinked: its kit JS expands font URLs from
  // URI templates at runtime, and Adobe Fonts licensing requires their CDN.
]);

// Hosts whose image URLs use Squarespace rendition params (?format=...) that can be collapsed.
const IMAGE_HOSTS = new Set([
  "images.squarespace-cdn.com",
  "static1.squarespace.com",
]);
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)$/i;

const SKIP_LINK_PREFIXES =
  /^\/(api|form|account|config|login|search|do-not-sell|checkout|cart|member)(\/|$)/;
const ASSET_EXT =
  /\.(css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|pdf|zip|woff2?|ttf|otf|eot|mp3|mp4|m4a|mov|xml|json|txt|rss|csv)$/i;

const CT_EXT: Record<string, string> = {
  "text/css": "css",
  "application/javascript": "js",
  "text/javascript": "js",
  "application/x-javascript": "js",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "font/woff2": "woff2",
  "font/woff": "woff",
  "font/opentype": "otf",
  "font/ttf": "ttf",
  "application/font-woff": "woff",
  "application/pdf": "pdf",
  "application/json": "json",
  "text/plain": "txt",
  "text/xml": "xml",
  "application/xml": "xml",
  "application/rss+xml": "xml",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
};

const OUT = new URL("../", import.meta.url).pathname;

const PAGE_CAP = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hash8(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function dirOf(rel: string): string {
  const i = rel.lastIndexOf("/");
  return i === -1 ? "" : rel.slice(0, i);
}

// Root-relative -> path relative to the file that will contain the reference.
function relFrom(fromDir: string, toRel: string): string {
  const from = fromDir === "" ? [] : fromDir.split("/");
  const to = toRel.split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return "../".repeat(from.length - i) + to.slice(i).join("/");
}

async function fetchResp(url: string, retries = 2): Promise<Response | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, {
        headers: { "user-agent": UA, accept: "*/*" },
        redirect: "follow",
      });
      if (r.status === 429 || r.status >= 500) {
        await sleep(600 * (i + 1));
        continue;
      }
      return r;
    } catch {
      await sleep(600 * (i + 1));
    }
  }
  return null;
}

async function writeBytes(rel: string, data: Uint8Array) {
  const p = OUT + rel;
  await Deno.mkdir(p.slice(0, p.lastIndexOf("/")), { recursive: true });
  await Deno.writeFile(p, data);
}

async function writeText(rel: string, text: string) {
  await writeBytes(rel, new TextEncoder().encode(text));
}

/** Clean up a raw URL-ish match and normalize to an https URL string, or null. */
function normalizeCandidate(raw: string): string | null {
  let u = raw.replace(/&amp;/g, "&").replace(/&(quot|lt|gt|#39|#x27);+$/, "");
  u = u.replace(/[.,;:)\]}'">]+$/, "");
  if (u.startsWith("//")) u = "https:" + u;
  if (!/^https?:\/\//i.test(u)) return null;
  try {
    const parsed = new URL(u);
    if (!LOCALIZE_HOSTS.has(parsed.hostname)) return null;
    parsed.hash = "";
    return "https://" + parsed.host + parsed.pathname + parsed.search;
  } catch {
    return null;
  }
}

/** Pull every localizable asset URL out of an HTML/CSS/JS text. */
function extractAssetUrls(text: string): string[] {
  const keys = new Set<string>();
  for (const m of text.matchAll(/(?:https?:)?\/\/[^\s"'<>\\()]+/g)) {
    const key = normalizeCandidate(m[0]);
    if (key) keys.add(key);
  }
  return [...keys];
}

function fileRelForPage(path: string): string {
  if (path === "/" || path === "") return "index.html";
  const p = path.replace(/\/+$/, "");
  return p.slice(1) + "/index.html";
}

interface Asset {
  keys: Set<string>; // every original URL that maps here
  rel: string; // root-relative local path
  isCss: boolean;
  isJs: boolean;
  text: string | null;
}

const pages = new Map<string, string>(); // page path -> html
const assets = new Map<string, Asset>(); // download key -> asset
const relTaken = new Set<string>(); // local rel paths already used
const failures: string[] = [];
let totalBytes = 0;

function downloadUrlFor(key: string, u: URL): string {
  // Collapse Squarespace rendition params: fetch one good-size rendition per image.
  if (IMAGE_HOSTS.has(u.hostname) && IMAGE_EXT.test(u.pathname)) {
    return "https://" + u.host + u.pathname + "?format=1500w";
  }
  return key;
}

async function downloadAsset(key: string): Promise<void> {
  const u = new URL(key);
  // Bare-host or directory-style URLs aren't downloadable assets — unless they
  // carry a query (Squarespace "combo" script URLs look like .../combo/?site.js).
  if (u.pathname === "" || (u.pathname.endsWith("/") && !u.search)) return;
  const isImage = IMAGE_HOSTS.has(u.hostname) && IMAGE_EXT.test(u.pathname);
  // Images collapse by pathname; everything else is distinguished by its query.
  const mapKey = isImage ? "https://" + u.host + u.pathname : key;
  if (assets.has(mapKey)) {
    assets.get(mapKey)!.keys.add(key);
    return;
  }

  const r = await fetchResp(downloadUrlFor(key, u));
  if (!r || !r.ok) {
    failures.push(key);
    return;
  }
  const buf = new Uint8Array(await r.arrayBuffer());
  totalBytes += buf.length;

  let rel = "assets/" + u.hostname + "/" + u.pathname.replace(/^\/+|\/+$/g, "");
  // macOS/GitHub cap filename length at 255 bytes; truncate huge basenames.
  const lastSlash = rel.lastIndexOf("/");
  if (rel.length - lastSlash - 1 > 180) {
    const dir = rel.slice(0, lastSlash + 1);
    const base = rel.slice(lastSlash + 1);
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    rel = dir + stem.slice(0, 120) + "-" + hash8(u.pathname + u.search) + ext;
  }
  if (!/\.[a-z0-9]{1,6}$/i.test(u.pathname)) {
    if (u.search) rel += "-" + hash8(u.search);
    const ct = (r.headers.get("content-type") || "").split(";")[0].trim()
      .toLowerCase();
    const ext = CT_EXT[ct];
    if (ext) rel += "." + ext;
  } else if (u.search && !isImage) {
    rel += "-" + hash8(u.search);
  }
  while (relTaken.has(rel)) rel += "-";
  relTaken.add(rel);

  const ct = (r.headers.get("content-type") || "").split(";")[0].trim()
    .toLowerCase();
  const isCss = ct === "text/css" || rel.endsWith(".css");
  const isJs = /javascript/.test(ct) || rel.endsWith(".js");
  const text = isCss || isJs ? new TextDecoder().decode(buf) : null;

  assets.set(mapKey, { keys: new Set([key]), rel, isCss, isJs, text });
  await writeBytes(rel, buf);

  // Queue assets referenced from inside css/js (font files, background images, chunks).
  if (text) {
    for (const k of extractAssetUrls(text)) assetQueue.push(k);
  }
}

const assetQueue: string[] = [];

/** Replacement pairs (variant -> local target) for rewriting one file. */
function buildReplacements(
  fromDir: string,
  rootAbsolute: boolean,
): [string, string][] {
  const pairs: [string, string][] = [];
  const target = (
    a: Asset,
  ) => (rootAbsolute ? "/" + a.rel : relFrom(fromDir, a.rel));
  for (const a of assets.values()) {
    const rep = target(a);
    const variants = new Set<string>();
    for (const key of a.keys) {
      const u = new URL(key);
      const pathq = u.pathname + u.search;
      for (
        const v of [
          "https://" + u.host + pathq,
          "http://" + u.host + pathq,
          "//" + u.host + pathq,
        ]
      ) {
        variants.add(v);
        if (v.includes("&")) variants.add(v.replace(/&/g, "&amp;"));
      }
      // Base form (no query) is only a safe alias for collapsed image renditions.
      if (IMAGE_HOSTS.has(u.hostname) && IMAGE_EXT.test(u.pathname)) {
        for (
          const v of [
            "https://" + u.host + u.pathname,
            "http://" + u.host + u.pathname,
            "//" + u.host + u.pathname,
          ]
        ) {
          variants.add(v);
        }
      }
    }
    for (const v of variants) pairs.push([v, rep]);
  }
  // Longest first so "url?format=100w" is replaced before its "url" prefix.
  pairs.sort((x, y) => y[0].length - x[0].length);
  return pairs;
}

function applyReplacements(text: string, pairs: [string, string][]): string {
  for (const [v, r] of pairs) {
    if (text.includes(v)) text = text.split(v).join(r);
  }
  return text;
}

/** Social-crawler tags need absolute URLs; re-absolutize against the final domain. */
function absolutizeSocialImages(html: string): string {
  const abs = (m: string, pre: string, val: string, post: string) => {
    const stripped = val.replace(/^(\.\.\/)+/, "");
    if (!/^(assets\/|\.\.\/)/.test(val)) return m;
    return pre + "https://" + FINAL_HOST + "/" + stripped + post;
  };
  return html
    .replace(
      /(property=["']og:image(?:[:][a-z_]+)?["'][^>]*content=["'])([^"']+)(["'])/gi,
      abs,
    )
    .replace(
      /(content=["'])([^"']+)(["'][^>]*property=["']og:image(?:[:][a-z_]+)?["'])/gi,
      abs,
    )
    .replace(
      /(name=["']twitter:image(?:[:][a-z_]+)?["'][^>]*content=["'])([^"']+)(["'])/gi,
      abs,
    )
    .replace(/(rel=["']image_src["'][^>]*href=["'])([^"']+)(["'])/gi, abs)
    .replace(/(itemprop=["']image["'][^>]*content=["'])([^"']+)(["'])/gi, abs);
}

/** Rewrite root-relative hrefs of mirrored pages to relative paths, so the tree
 *  works at any base URL (github.io project preview included). Absolute hrefs
 *  (canonical, image_src, og:url) are intentionally left absolute. */
function rewritePageLinks(fromDir: string, html: string): string {
  const target = (p: string): string | null => {
    if (p === "/" || p === "") return fromDir === "" ? "./" : "../";
    const norm = p.replace(/\/+$/, "");
    if (!pages.has(norm)) return null;
    const to = norm.replace(/^\/+/, "").split("/");
    const from = fromDir === "" ? [] : fromDir.split("/");
    let i = 0;
    while (i < from.length && i < to.length && from[i] === to[i]) i++;
    return "../".repeat(from.length - i) + to.slice(i).join("/") + "/";
  };
  return html.replace(/href=["'](\/[^"'#]*)["']/g, (m, p) => {
    if (
      p.startsWith("//") || p.includes("?") || ASSET_EXT.test(p) ||
      SKIP_LINK_PREFIXES.test(p)
    ) {
      return m;
    }
    const t = target(p);
    return t === null ? m : `href="${t}"`;
  });
}

function rewriteAndSavePage(path: string, html: string) {
  const fileRel = fileRelForPage(path);
  const pairs = buildReplacements(dirOf(fileRel), false);
  let out = applyReplacements(html, pairs);
  out = rewritePageLinks(dirOf(fileRel), out);
  out = absolutizeSocialImages(out);
  return writeText(fileRel, out);
}

async function main() {
  console.log(`Mirroring ${ORIGIN} -> ${OUT}`);

  // --- 1. sitemap + robots ----------------------------------------------------
  const sitemapResp = await fetchResp(ORIGIN + "/sitemap.xml");
  const sitemapXml = sitemapResp && sitemapResp.ok
    ? await sitemapResp.text()
    : "";
  if (sitemapXml) await writeText("sitemap.xml", sitemapXml);

  const robotsResp = await fetchResp(ORIGIN + "/robots.txt");
  if (robotsResp && robotsResp.ok) {
    await writeText("robots.txt", await robotsResp.text());
  }

  // --- 2. crawl pages ---------------------------------------------------------
  const queue: string[] = ["/"];
  const seen = new Set<string>(["/"]);
  for (const m of sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    try {
      const u = new URL(m[1]);
      if (u.hostname !== "www.ejg2.com" && u.hostname !== "ejg2.com") continue;
      if (u.search) continue;
      const p = u.pathname;
      if (!seen.has(p) && !ASSET_EXT.test(p) && !SKIP_LINK_PREFIXES.test(p)) {
        seen.add(p);
        queue.push(p);
      }
    } catch { /* ignore bad loc */ }
  }

  while (queue.length > 0) {
    if (pages.size >= PAGE_CAP) {
      console.log(
        `Page cap (${PAGE_CAP}) reached; ${queue.length} URLs left unvisited.`,
      );
      break;
    }
    const path = queue.shift()!;
    const r = await fetchResp(ORIGIN + encodeURI(path));
    if (!r || !r.ok) {
      console.log(`  skip ${path} (HTTP ${r ? r.status : "error"})`);
      continue;
    }
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("html")) {
      console.log(`  skip ${path} (content-type ${ct || "unknown"})`);
      continue;
    }
    const html = await r.text();
    pages.set(path, html);
    for (const k of extractAssetUrls(html)) assetQueue.push(k);

    // Discover internal links.
    for (const m of html.matchAll(/href=["']([^"']+)["']/g)) {
      let href = m[1].replace(/&amp;/g, "&").trim();
      if (/^(#|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
      try {
        const u = new URL(href, ORIGIN + path);
        if (u.hostname !== "www.ejg2.com" && u.hostname !== "ejg2.com") {
          continue;
        }
        if (u.search) continue;
        const p = u.pathname.replace(/\/+$/, "") || "/";
        if (
          p === "/" || seen.has(p) || ASSET_EXT.test(p) ||
          SKIP_LINK_PREFIXES.test(p)
        ) continue;
        seen.add(p);
        queue.push(p);
      } catch { /* ignore */ }
    }
    await sleep(40);
  }
  console.log(`Crawled ${pages.size} pages.`);

  // --- 2.5 fetch the 404 body early so its assets join the download queue ----
  let notFoundHtml: string | null = null;
  const nf = await fetchResp(ORIGIN + "/this-page-does-not-exist-404");
  if (nf && (nf.status === 404 || nf.status === 200)) {
    const body = await nf.text();
    if (body.length > 500) {
      notFoundHtml = body;
      for (const k of extractAssetUrls(body)) assetQueue.push(k);
    }
  }

  // --- 3. download assets (BFS, includes css/js-referenced assets) ------------
  while (assetQueue.length > 0) {
    const key = assetQueue.shift()!;
    await downloadAsset(key);
  }
  const mb = (totalBytes / 1024 / 1024).toFixed(1);
  console.log(
    `Downloaded ${assets.size} assets (${mb} MB). Failures: ${failures.length}`,
  );

  // --- 4. rewrite css/js ------------------------------------------------------
  for (const a of assets.values()) {
    if (!a.text) continue;
    // JS: root-absolute (script-injected URLs resolve against the document).
    // CSS: relative to the css file itself.
    const pairs = buildReplacements(dirOf(a.rel), a.isJs);
    const out = applyReplacements(a.text, pairs);
    if (out !== a.text) await writeText(a.rel, out);
  }

  // --- 5. rewrite pages -------------------------------------------------------
  for (const [path, html] of pages) {
    await rewriteAndSavePage(path, html);
  }

  // --- 6. 404 page ------------------------------------------------------------
  if (notFoundHtml) {
    const pairs = buildReplacements("", false);
    let out = applyReplacements(notFoundHtml, pairs);
    out = rewritePageLinks("", out);
    await writeText("404.html", absolutizeSocialImages(out));
  }

  // --- 7. GitHub Pages config -------------------------------------------------
  await writeText("CNAME", FINAL_HOST + "\n");
  await writeText(".nojekyll", "");

  // --- 8. summary -------------------------------------------------------------
  console.log(`\nPages saved: ${pages.size}`);
  for (const p of [...pages.keys()].sort()) {
    console.log("  " + (p === "/" ? "/" : p));
  }
  if (failures.length > 0) {
    console.log(
      `\nFailed downloads (left hotlinked to CDN): ${failures.length}`,
    );
    for (const f of [...new Set(failures)]) console.log("  " + f);
  }
  console.log(`\nDone. Output: ${OUT}`);
}

await main();
