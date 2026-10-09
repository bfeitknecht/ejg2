#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * One-time content migration: parse the legacy Squarespace mirror in .legacy/
 * into clean, typed JSON under src/content/. The new site build (tools/build.ts)
 * consumes only these JSON files — the legacy mirror is not needed at runtime.
 *
 * Usage: deno task extract
 */

import { parseHTML } from "linkedom";

const LEGACY = new URL("../.legacy/", import.meta.url).pathname;
const OUT = new URL("../src/content/", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// URL/path mapping
// ---------------------------------------------------------------------------

/** Legacy page path -> new site path. */
const PATH_MAP: Record<string, string> = {
  "/": "/",
  "/main/": "/",
  "/miscellaneous/": "/contact/",
  "/projects/": "/projects/",
  "/work/": "/work/",
  "/letter-to-lucy/": "/letter-to-lucy/",
  "/letter-to-lucy-bibliography-and-credits/":
    "/letter-to-lucy-bibliography-and-credits/",
  "/stills/": "/stills/",
  "/sketches/": "/sketches/",
  "/mashups/": "/mashups/",
  "/oscars-2019/": "/oscars-2019/",
  "/audiovisual/": "/audiovisual/",
  "/video/": "/video/",
  "/play/": "/play/",
  "/postcards/": "/postcards/",
  "/things/": "/things/",
  "/ejg2-blog/": "/blog/",
  "/ejg2-blog/2019/2/22/oscars-2019/": "/blog/oscars-2019/",
  "/ejg2-projects/": "/projects/",
  "/ejg2-projects/2021/7/13/i-was-an-anti-abortion-leader/":
    "/projects/i-was-an-anti-abortion-leader/",
  "/ejg2-projects/2021/7/13/in-conversation-with-frank-schaeffer/":
    "/projects/in-conversation-with-frank-schaeffer/",
  "/ejg2-projects/2023/1/19/love-in-common/": "/projects/love-in-common/",
};

/** Pages dropped from the new site; their legacy paths redirect via 404.html. */
const DROPPED: Record<string, string> = {
  "/ejg2-projects/category/graphic-design/": "/projects/",
  "/ejg2-projects/category/podcast/": "/projects/",
  "/ejg2-projects/category/video/": "/projects/",
  "/ejg2-projects/tag/frank-schaeffer/": "/projects/",
  "/ejg2-projects/tag/love-in-common/": "/projects/",
  "/ejg2-blog/tag/oscars-2019/": "/blog/",
};

const SITE_ID = "52097ce4e4b0cc1763c7be8c";

interface AssetCopy {
  legacy: string; // path under .legacy/
  dest: string; // path in the built site (no leading slash)
}
const assetManifest = new Map<string, AssetCopy>();

function noteAsset(legacyRel: string, dest: string) {
  const key = dest;
  if (!assetManifest.has(key)) {
    assetManifest.set(key, { legacy: legacyRel, dest });
  }
}

/** Legacy local asset ref (as rewritten by the old mirror) -> new site path. */
function mapAssetRef(ref: string): string | null {
  let p = ref.split("?")[0].split("#")[0];
  p = p.replace(/^\.\//, "");
  // normalize "../assets/..." -> "assets/..."
  p = p.replace(/^(?:\.\.\/)+/, (m) => (m.includes("assets") ? "" : m));
  p = p.replace(/^(?:\.\.\/)+assets\//, "assets/");
  if (p.startsWith("assets/images.squarespace-cdn.com/content/v1/")) {
    const rest = p.slice(
      "assets/images.squarespace-cdn.com/content/v1/".length,
    );
    const withoutSite = rest.startsWith(SITE_ID + "/")
      ? rest.slice(SITE_ID.length + 1)
      : rest;
    const dest = "img/" + withoutSite;
    noteAsset(p, dest);
    return "/" + dest;
  }
  if (p.startsWith("assets/static1.squarespace.com/")) {
    const name = p.split("/").pop()!;
    const dest = "img/" + name;
    noteAsset(p, dest);
    return "/" + dest;
  }
  if (p.startsWith("assets/file.squarespace-cdn.com/")) {
    const name = decodeURIComponent(p.split("/").pop()!);
    const dest = "files/" + name;
    noteAsset(p, dest);
    return "/" + dest;
  }
  if (p.startsWith("assets/files/")) {
    const name = p.split("/").pop()!;
    const dest = "files/" + name;
    noteAsset(p, dest);
    return "/" + dest;
  }
  return null;
}

/** Resolve a (possibly relative) href against the page's own path. */
function resolveLegacyPath(pagePath: string, href: string): string {
  if (
    /^(https?:)?\/\//i.test(href) ||
    /^(mailto:|tel:|javascript:|data:|#)/i.test(href)
  ) {
    return href;
  }
  const clean = href.split("?")[0].split("#")[0];
  if (clean === "") return pagePath;
  const isFile = /\.[a-z0-9]{1,6}$/i.test(clean.split("/").pop() || "");
  if (clean.startsWith("/")) {
    return clean.endsWith("/") || isFile ? clean : clean + "/";
  }
  // seed the stack with the page's own directory so ".." can climb out
  const out = pagePath.split("/").filter(Boolean);
  for (const part of clean.split("/").filter(Boolean)) {
    if (part === "..") out.pop();
    else if (part !== ".") out.push(part);
  }
  return "/" + out.join("/") + (isFile || out.length === 0 ? "" : "/");
}

/** Legacy page path -> new path, or null when the target is dropped. */
function mapPagePath(legacyPath: string): string | null {
  const key = legacyPath.toLowerCase();
  if (PATH_MAP[key]) return PATH_MAP[key];
  if (DROPPED[key]) return DROPPED[key];
  // tag/category pages under either collection
  if (/^\/ejg2-(projects|blog)\/(category|tag)\//.test(key)) {
    return key.startsWith("/ejg2-projects/") ? "/projects/" : "/blog/";
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTML sanitizing
// ---------------------------------------------------------------------------

const KEEP_TAGS = new Set([
  "P",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "EM",
  "STRONG",
  "B",
  "I",
  "BR",
  "HR",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "A",
  "IMG",
  "FIGURE",
  "FIGCAPTION",
]);
const DEMOTE: Record<string, string> = {
  H1: "H2",
  H2: "H3",
  H3: "H4",
  H4: "H5",
  H5: "H6",
  B: "STRONG",
  I: "EM",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface SanitizeCtx {
  pagePath: string;
  warnings: string[];
}

function sanitizeNode(node: Node, ctx: SanitizeCtx): string {
  if (node.nodeType === 3) {
    return (node.textContent || "").replace(/\s+/g, " ");
  }
  if (node.nodeType !== 1) return ""; // comments etc.
  const el = node as Element;
  const tag = (el.tagName || "").toUpperCase();

  if (
    [
      "SCRIPT",
      "STYLE",
      "TEMPLATE",
      "NOSCRIPT",
      "FORM",
      "INPUT",
      "BUTTON",
      "SELECT",
      "TEXTAREA",
      "IFRAME",
      "SVG",
      "VIDEO",
      "AUDIO",
      "SOURCE",
    ].includes(tag)
  ) {
    return "";
  }

  // Unwrap containers: emit children only.
  const UNWRAP = new Set([
    "DIV",
    "SPAN",
    "FONT",
    "SECTION",
    "ARTICLE",
    "HEADER",
    "FOOTER",
    "MAIN",
    "CENTER",
    "TABLE",
    "TBODY",
    "TR",
    "TD",
    "TH",
    "FIGURE",
    "FIGCAPTION",
  ]);
  if (tag === "FIGCAPTION") {
    const text = el.textContent.replace(/\s+/g, " ").trim();
    return text ? `<figcaption>${text}</figcaption>` : "";
  }
  if (UNWRAP.has(tag)) {
    return [...el.childNodes].map((c) => sanitizeNode(c, ctx)).join("");
  }

  if (tag === "BR") return "<br>";
  if (tag === "HR") return "<hr>";

  if (tag === "IMG") {
    const raw = el.getAttribute("src") || el.getAttribute("data-src") || "";
    const mapped = raw ? mapAssetRef(raw) : null;
    if (!mapped) {
      ctx.warnings.push(`unmapped image: ${raw.slice(0, 90)}`);
      return "";
    }
    const alt = (el.getAttribute("alt") || "").trim();
    return `<img src="${mapped}" alt="${esc(alt)}" loading="lazy">`;
  }

  if (tag === "A") {
    const href = (el.getAttribute("href") || "").trim();
    if (!href || href.startsWith("#")) {
      return [...el.childNodes].map((c) => sanitizeNode(c, ctx)).join("");
    }
    if (/^(mailto:|tel:)/i.test(href)) {
      return `<a href="${esc(href)}">${
        [...el.childNodes].map((c) => sanitizeNode(c, ctx)).join("")
      }</a>`;
    }
    if (/^(https?:)?\/\//i.test(href) && !/ejg2\.com/i.test(href)) {
      const inner = [...el.childNodes].map((c) => sanitizeNode(c, ctx)).join(
        "",
      );
      return `<a href="${
        esc(href)
      }" target="_blank" rel="noopener">${inner}</a>`;
    }
    // absolute link back to the legacy site -> treat as internal
    const internalHref = href.replace(/^https?:\/\/(?:www\.)?ejg2\.com/i, "");
    const legacyPath = resolveLegacyPath(ctx.pagePath, internalHref || "/");
    // file downloads served at /s/
    if (/^\/s\//.test(legacyPath)) {
      const name = legacyPath.split("/").pop()!;
      noteAsset("assets/files/" + name, "files/" + name);
      const inner = [...el.childNodes].map((c) => sanitizeNode(c, ctx)).join(
        "",
      );
      return `<a href="/files/${name}">${inner}</a>`;
    }
    const mapped = mapPagePath(legacyPath);
    if (!mapped) {
      ctx.warnings.push(
        `unmapped link: ${legacyPath} (text: ${
          el.textContent.trim().slice(0, 40)
        })`,
      );
      return [...el.childNodes].map((c) => sanitizeNode(c, ctx)).join("");
    }
    const inner = [...el.childNodes].map((c) => sanitizeNode(c, ctx)).join("");
    return `<a href="${mapped}">${inner}</a>`;
  }

  if (!KEEP_TAGS.has(tag)) {
    return [...el.childNodes].map((c) => sanitizeNode(c, ctx)).join("");
  }

  const outTag = (DEMOTE[tag] || tag).toLowerCase();
  const inner = [...el.childNodes].map((c) => sanitizeNode(c, ctx)).join("");
  if (
    ["P", "UL", "OL", "LI", "BLOCKQUOTE", "H2", "H3", "H4", "H5", "H6"]
      .includes(outTag)
  ) {
    const trimmed = inner.replace(/^\s+|\s+$/g, "");
    if (trimmed === "") return "";
    return `<${outTag}>${trimmed}</${outTag}>`;
  }
  return `<${outTag}>${inner}</${outTag}>`;
}

function sanitizeHTML(
  html: string,
  pagePath: string,
  warnings: string[],
): string {
  // linkedom drops bare fragments; it needs a full document wrapper.
  const { document } = parseHTML(
    `<!doctype html><html><head></head><body>${html}</body></html>`,
  );
  const ctx: SanitizeCtx = { pagePath, warnings };
  const out = [...document.body.childNodes].map((c) => sanitizeNode(c, ctx))
    .join("");
  return out.replace(/(<br>\s*){3,}/g, "<br><br>").replace(/(<hr>)/g, "<hr>")
    .trim();
}

// ---------------------------------------------------------------------------
// Block extraction
// ---------------------------------------------------------------------------

type Block =
  | { type: "richtext"; html: string }
  | {
    type: "image";
    src: string;
    alt: string;
    width?: number;
    height?: number;
    caption?: string;
    href?: string;
  }
  | {
    type: "gallery";
    images: { src: string; alt: string; width?: number; height?: number }[];
  }
  | { type: "embed"; provider: "youtube" | "vimeo"; id: string; title?: string }
  | { type: "button"; label: string; href: string }
  | { type: "hr" }
  | { type: "contact-form" };

function dims(el: Element): { width?: number; height?: number } {
  const d = el.getAttribute("data-image-dimensions") || "";
  const m = d.match(/^(\d+)x(\d+)$/);
  return m ? { width: +m[1], height: +m[2] } : {};
}

function extractImageBlock(
  block: Element,
  pagePath: string,
  warnings: string[],
): Block | null {
  const img = block.querySelector("img");
  if (!img) return null;
  const raw = img.getAttribute("data-src") || img.getAttribute("src") || "";
  const src = raw ? mapAssetRef(raw) : null;
  if (!src) {
    warnings.push(`image-block without mappable src: ${raw.slice(0, 80)}`);
    return null;
  }
  const captionEl = block.querySelector("figcaption, .image-caption");
  const caption = captionEl
    ? captionEl.textContent.replace(/\s+/g, " ").trim()
    : "";
  const linkEl = block.querySelector(
    ".image-block-wrapper a, figure a, a[href]",
  );
  let href: string | undefined;
  if (linkEl) {
    const h = linkEl.getAttribute("href") || "";
    if (h && !h.startsWith("#")) {
      const legacy = resolveLegacyPath(pagePath, h);
      if (/^https?:\/\//.test(legacy) && !/ejg2\.com/.test(legacy)) {
        href = legacy;
      } else if (/^\/s\//.test(legacy)) {
        const name = legacy.split("/").pop()!;
        noteAsset("assets/files/" + name, "files/" + name);
        href = "/files/" + name;
      } else {
        const mapped = mapPagePath(legacy);
        if (mapped) href = mapped;
      }
    }
  }
  const d = dims(img);
  return {
    type: "image",
    src,
    alt: (img.getAttribute("alt") || "").trim(),
    ...d,
    caption: caption || undefined,
    href,
  };
}

function extractEmbed(block: Element, warnings: string[]): Block | null {
  const html = block.innerHTML || "";
  const yt = html.match(/youtube\.com\/embed\/([\w-]{6,})/) ||
    html.match(/youtube\.com\/watch\?v=([\w-]{6,})/);
  if (yt) return { type: "embed", provider: "youtube", id: yt[1] };
  const vm = html.match(/vimeo\.com\/(?:video\/)?(\d{5,})/);
  if (vm) return { type: "embed", provider: "vimeo", id: vm[1] };
  return null;
}

function extractBlocks(
  root: Element,
  pagePath: string,
  warnings: string[],
): Block[] {
  const blocks: Block[] = [];
  const seen = new Set<Node>();

  for (const block of root.querySelectorAll(".sqs-block")) {
    if (seen.has(block)) continue;
    // skip blocks nested inside other blocks
    let p = block.parentElement as Element | null;
    let nested = false;
    while (p) {
      if (seen.has(p) || (p.classList && p.classList.contains("sqs-block"))) {
        nested = true;
        break;
      }
      p = p.parentElement as Element | null;
    }
    if (nested) continue;
    seen.add(block);

    const cls = block.className || "";
    const content = block.querySelector(".sqs-block-content");

    if (/form-block/.test(cls)) {
      blocks.push({ type: "contact-form" });
      continue;
    }
    if (/video-block/.test(cls)) {
      const embed = extractEmbed(block, warnings);
      if (embed) {
        blocks.push(embed);
        continue;
      }
    }
    if (/image-block/.test(cls)) {
      const b = extractImageBlock(block, pagePath, warnings);
      if (b) blocks.push(b);
      continue;
    }
    if (/gallery-block/.test(cls)) {
      const images = [...block.querySelectorAll("img")]
        .map((img) => {
          const raw = img.getAttribute("data-src") || img.getAttribute("src") ||
            "";
          const src = raw ? mapAssetRef(raw) : null;
          if (!src) return null;
          return {
            src,
            alt: (img.getAttribute("alt") || "").trim(),
            ...dims(img),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (images.length) blocks.push({ type: "gallery", images });
      continue;
    }
    if (/website-component-block/.test(cls)) {
      if (/horizontalrule/.test(cls)) {
        blocks.push({ type: "hr" });
      } else if (/button-block/.test(cls)) {
        const a = block.querySelector("a");
        if (a) {
          const href = (a.getAttribute("href") || "").trim();
          const label = a.textContent.replace(/\s+/g, " ").trim();
          if (href && label) {
            const legacy = resolveLegacyPath(pagePath, href);
            let mapped: string | null = null;
            if (/^https?:\/\//.test(legacy) && !/ejg2\.com/.test(legacy)) {
              mapped = legacy;
            } else if (/^\/s\//.test(legacy)) {
              const name = legacy.split("/").pop()!;
              noteAsset("assets/files/" + name, "files/" + name);
              mapped = "/files/" + name;
            } else {
              const p = mapPagePath(legacy);
              if (p) mapped = p;
            }
            if (mapped) blocks.push({ type: "button", label, href: mapped });
          }
        }
      }
      continue;
    }
    if (content) {
      const html = sanitizeHTML(content.innerHTML, pagePath, warnings);
      if (html) blocks.push({ type: "richtext", html });
    }
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Page extraction
// ---------------------------------------------------------------------------

interface PageContent {
  path: string;
  title: string;
  description: string;
  layout: string;
  blocks?: Block[];
  images?: { src: string; alt: string; width?: number; height?: number }[];
  embeds?: { provider: string; id: string; title?: string }[];
  cards?: { label: string; href: string; img: string }[];
  date?: string;
  category?: string;
  tags?: string[];
}

function pageTitle(doc: Document): string {
  const t = doc.querySelector("title")?.textContent || "";
  return t.replace(/\s*—\s*EJG2\s*$/i, "").replace(/&mdash;/g, "—").trim();
}

function metaDescription(doc: Document): string {
  return doc.querySelector('meta[name="description"]')?.getAttribute("content")
    ?.trim() || "";
}

function extractGallerySlides(
  doc: Document,
  pagePath: string,
  warnings: string[],
) {
  const images: PageContent["images"] = [];
  for (const slide of doc.querySelectorAll("#mainContent .slide")) {
    const img = slide.querySelector("img");
    if (!img) continue;
    const raw = img.getAttribute("data-src") ||
      img.getAttribute("data-image") || "";
    const src = raw ? mapAssetRef(raw) : null;
    if (!src) {
      warnings.push(`slide image unmapped: ${raw.slice(0, 80)}`);
      continue;
    }
    images.push({
      src,
      alt: (img.getAttribute("alt") || "").trim(),
      ...dims(img),
    });
  }
  return images;
}

function extractArticle(doc: Document, pagePath: string, warnings: string[]) {
  const art = doc.querySelector("#mainContent article");
  if (!art) return null;
  const h1 = art.querySelector("h1.entry-title");
  const title = h1
    ? (h1.querySelector("a")?.textContent ||
      (() => {
        h1.querySelectorAll("span.date, span.author").forEach((s) =>
          s.remove()
        );
        return h1.textContent;
      })() || "").replace(/\s+/g, " ").trim()
    : "";
  const date = art.querySelector("time.published")?.getAttribute("datetime") ||
    undefined;
  const category = art.querySelector(".category a")?.textContent.trim() ||
    undefined;
  const tags = [...art.querySelectorAll(".tag a")].map((a) =>
    a.textContent.trim()
  );
  const body = art.querySelector(".body.entry-content");
  const blocks = body ? extractBlocks(body, pagePath, warnings) : [];
  return { title, date, category, tags, blocks };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const PAGES: { path: string; file: string; layout: string }[] = [
  { path: "/", file: "index.html", layout: "cover" },
  { path: "/work/", file: "work/index.html", layout: "page" },
  // /projects/ and /ejg2-blog/ listings are generated from post data at build time
  {
    path: "/ejg2-projects/2021/7/13/i-was-an-anti-abortion-leader/",
    file: "ejg2-projects/2021/7/13/i-was-an-anti-abortion-leader/index.html",
    layout: "post",
  },
  {
    path: "/ejg2-projects/2021/7/13/in-conversation-with-frank-schaeffer/",
    file:
      "ejg2-projects/2021/7/13/in-conversation-with-frank-schaeffer/index.html",
    layout: "post",
  },
  {
    path: "/ejg2-projects/2023/1/19/love-in-common/",
    file: "ejg2-projects/2023/1/19/love-in-common/index.html",
    layout: "post",
  },
  {
    path: "/letter-to-lucy/",
    file: "letter-to-lucy/index.html",
    layout: "page",
  },
  {
    path: "/letter-to-lucy-bibliography-and-credits/",
    file: "letter-to-lucy-bibliography-and-credits/index.html",
    layout: "page",
  },
  { path: "/stills/", file: "stills/index.html", layout: "gallery" },
  { path: "/sketches/", file: "sketches/index.html", layout: "gallery" },
  { path: "/mashups/", file: "mashups/index.html", layout: "gallery" },
  { path: "/oscars-2019/", file: "oscars-2019/index.html", layout: "gallery" },
  { path: "/audiovisual/", file: "audiovisual/index.html", layout: "hub" },
  { path: "/video/", file: "video/index.html", layout: "gallery" },
  { path: "/play/", file: "play/index.html", layout: "page" },
  { path: "/postcards/", file: "postcards/index.html", layout: "page" },
  { path: "/things/", file: "things/index.html", layout: "page" },
  {
    path: "/miscellaneous/",
    file: "miscellaneous/index.html",
    layout: "contact",
  },
  // /ejg2-blog/ listing generated from post data at build time
  {
    path: "/ejg2-blog/2019/2/22/oscars-2019/",
    file: "ejg2-blog/2019/2/22/oscars-2019/index.html",
    layout: "post",
  },
];

await Deno.mkdir(OUT, { recursive: true });
await Deno.mkdir(OUT + "pages/", { recursive: true });

const allWarnings: Record<string, string[]> = {};

for (const page of PAGES) {
  const html = await Deno.readTextFile(LEGACY + page.file);
  const { document } = parseHTML(html);
  const warnings: string[] = [];
  const newPath = PATH_MAP[page.path];
  const title = pageTitle(document);
  const description = metaDescription(document);

  const content: PageContent = {
    path: newPath,
    title,
    description,
    layout: page.layout,
  };

  if (page.layout === "cover") {
    const logo = document.querySelector(
      '.sqs-slice[data-compound-type="logo"] img',
    );
    const bg = document.querySelector(
      '.sqs-slice[data-slice-type="gallery"] img',
    );
    const logoSrc = logo
      ? mapAssetRef(
        logo.getAttribute("data-src") || logo.getAttribute("src") || "",
      )
      : null;
    const bgSrc = bg
      ? mapAssetRef(
        bg.getAttribute("data-src") || bg.getAttribute("data-image") || "",
      )
      : null;
    if (logoSrc) (content as unknown as Record<string, unknown>).logo = logoSrc;
    if (bgSrc) {
      (content as unknown as Record<string, unknown>).background = bgSrc;
    }
  } else if (page.layout === "gallery") {
    content.images = extractGallerySlides(document, page.path, warnings);
    // video collections may carry embeds instead of plain slides
    const embeds: PageContent["embeds"] = [];
    const htmlText = await Deno.readTextFile(LEGACY + page.file);
    const yt = htmlText.match(/youtube\.com\/embed\/([\w-]{6,})/);
    if (yt) {
      embeds.push({
        provider: "youtube",
        id: yt[1],
        title: "Closer to Mommie Dearest",
      });
    }
    if (embeds.length) {
      content.embeds = embeds;
      content.images = []; // poster frames duplicate the embed
    }
    const bodyText = document.querySelector("#mainContent");
    if (bodyText) {
      const blocks = extractBlocks(bodyText, page.path, warnings);
      if (blocks.length) content.blocks = blocks;
    }
  } else if (page.layout === "hub") {
    // slide-based index pages (e.g. /audiovisual): image cards linking to sub-pages
    const cards: PageContent["cards"] = [];
    for (const slide of document.querySelectorAll("#mainContent .slide")) {
      const img = slide.querySelector("img");
      const a = slide.querySelector(".collection-detail-wrapper a, a[href]");
      if (!img || !a) continue;
      const raw = img.getAttribute("data-src") || img.getAttribute("src") || "";
      const src = raw ? mapAssetRef(raw) : null;
      const href = mapPagePath(
        resolveLegacyPath(page.path, a.getAttribute("href") || ""),
      );
      if (!src || !href) {
        warnings.push(
          `hub slide unmapped: ${raw.slice(0, 60)} -> ${
            a.getAttribute("href")
          }`,
        );
        continue;
      }
      const label = (a.textContent || "").replace(/\s+/g, " ").trim();
      cards.push({
        label: label.replace(/^AV\s*\/\s*/i, "").trim() || label,
        href,
        img: src,
      });
    }
    if (cards.length) content.cards = cards;
    const main = document.querySelector("#mainContent");
    if (main) {
      const blocks = extractBlocks(main, page.path, warnings);
      if (blocks.length) content.blocks = blocks;
    }
  } else if (page.layout === "post") {
    const art = extractArticle(document, page.path, warnings);
    if (art) {
      content.title = art.title || title;
      content.date = art.date;
      content.category = art.category;
      content.tags = art.tags.length ? art.tags : undefined;
      content.blocks = art.blocks;
    } else {
      warnings.push("no article found");
    }
  } else {
    const main = document.querySelector("#mainContent");
    if (main) {
      content.blocks = extractBlocks(main, page.path, warnings);
    } else {
      warnings.push("no #mainContent");
    }
    if (page.layout === "contact") {
      content.blocks = content.blocks || [];
      if (!content.blocks.some((b) => b.type === "contact-form")) {
        content.blocks.push({ type: "contact-form" });
      }
    }
  }

  const slug = page.path === "/"
    ? "home"
    : page.path.replaceAll("/", "-").replace(/^-|-$/g, "");
  await Deno.writeTextFile(
    OUT + `pages/${slug}.json`,
    JSON.stringify(content, null, 2) + "\n",
  );
  allWarnings[page.path] = warnings;
  console.log(
    `${page.path} -> ${slug}.json  [${content.layout}] blocks:${
      content.blocks?.length ?? 0
    } images:${content.images?.length ?? 0}`,
  );
}

// ---------------------------------------------------------------------------
// site.json
// ---------------------------------------------------------------------------

const site = {
  title: "EJG2",
  tagline: "Print. Digital. Web. Social.",
  description: "Print. Digital. Web. Social.",
  logo: "/img/EJG2-Logo-1973.png",
  favicon: "/img/favicon.ico",
  coverBackground: "/img/1475289768202-33O4NNK2MVSSNU50HF7U/100_1555.JPG",
  email: "e@ejg2.com",
  address: ["P.O. Box 1032", "Laveen, AZ 85339", "USA"],
  nav: [
    { label: "Work", href: "/work/" },
    { label: "Projects", href: "/projects/" },
    { label: "Book", href: "/letter-to-lucy/" },
    { label: "Contact", href: "/contact/" },
  ],
  formEndpoint: "https://formsubmit.co/ajax/e@ejg2.com",
};
await Deno.writeTextFile(
  OUT + "site.json",
  JSON.stringify(site, null, 2) + "\n",
);

// The logo + favicon come from the static1 CDN paths; register them explicitly.
noteAsset(
  "assets/static1.squarespace.com/static/" + SITE_ID +
    "/t/5727fcc1746fb999530460c7/1462238403848/EJG2-Logo-1973.png",
  "img/EJG2-Logo-1973.png",
);
noteAsset(
  // the legacy mirror saved the favicon with a query-hash suffix
  "assets/images.squarespace-cdn.com/content/v1/" + SITE_ID +
    "/1420663579981-53LAM6WBXRWQONTQF01S/favicon.ico-fd50d112",
  "img/favicon.ico",
);

await Deno.writeTextFile(
  OUT + "assets-manifest.json",
  JSON.stringify(Object.fromEntries(assetManifest), null, 2) + "\n",
);

console.log(`\nAssets referenced: ${assetManifest.size}`);
let warned = 0;
for (const [page, ws] of Object.entries(allWarnings)) {
  if (ws.length) {
    warned++;
    console.log(`\nWarnings for ${page}:`);
    for (const w of [...new Set(ws)]) console.log("  - " + w);
  }
}
if (!warned) console.log("No warnings.");
