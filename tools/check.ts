#!/usr/bin/env -S deno run --allow-read
/**
 * Verify the built site:
 *  - every local reference in HTML/CSS resolves to a file
 *  - no Squarespace domains are referenced anywhere in the output
 *  - GitHub Pages config files exist
 */

const ROOT = new URL("../", import.meta.url).pathname;
const missing = new Set<string>();
const cdnRefs = new Map<string, Set<string>>();

function* walk(dir: string): Generator<string> {
  for (const e of Deno.readDirSync(dir)) {
    const p = dir + "/" + e.name;
    if (e.isDirectory) {
      if (
        e.name === ".git" || e.name === ".legacy" ||
        e.name === "node_modules" || e.name === "tools" || e.name === "src"
      ) continue;
      yield* walk(p);
    } else yield p;
  }
}

function exists(p: string): boolean {
  try {
    Deno.statSync(p);
    return true;
  } catch {
    return false;
  }
}

function resolveLocal(dir: string, ref: string): string {
  // root-absolute refs resolve against the site root (custom-domain deployment)
  if (ref.startsWith("/")) dir = "";
  const parts = (dir === "" ? [] : dir.split("/")).concat(ref.split("/"));
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return ROOT + out.join("/");
}

function checkRef(file: string, dir: string, ref: string) {
  if (
    !ref || /^(https?:)?\/\//.test(ref) ||
    /^(data:|mailto:|tel:|#|javascript:)/.test(ref)
  ) return;
  if (ref.startsWith("?") || ref.startsWith("#")) return;
  const clean = ref.split("?")[0].split("#")[0];
  if (!clean) return;
  if (!exists(resolveLocal(dir, clean))) missing.add(`${file} -> ${ref}`);
}

for (const f of walk(ROOT)) {
  const rel = f.slice(ROOT.length);
  const dir = rel.slice(0, rel.lastIndexOf("/"));
  if (/\.(html|css|js)$/.test(f)) {
    const text = await Deno.readTextFile(f);
    for (const m of text.matchAll(/(?:src|href|poster)=["']([^"']+)["']/g)) {
      checkRef(rel, dir, m[1]);
    }
    for (const m of text.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
      checkRef(rel, dir, m[2]);
    }
    for (const m of text.matchAll(/srcset=["']([^"']+)["']/g)) {
      for (const entry of m[1].split(",")) {
        checkRef(rel, dir, entry.trim().split(/\s+/)[0]);
      }
    }
  }
  if (f.endsWith(".html")) {
    const text = await Deno.readTextFile(f);
    for (
      const m of text.matchAll(
        /(?:https?:)?\/\/[a-z0-9.-]*squarespace[a-z0-9.-]*\.[a-z]{2,}[^\s"'<>\\()]*/gi,
      )
    ) {
      const set = cdnRefs.get(m[0]) ?? new Set();
      set.add(rel);
      cdnRefs.set(m[0], set);
    }
  }
}

let ok = true;
if (missing.size) {
  ok = false;
  console.log(`MISSING (${missing.size}):`);
  for (const m of missing) console.log("  " + m);
} else {
  console.log("All local references resolve.");
}
if (cdnRefs.size) {
  ok = false;
  console.log(`SQUARESPACE REFS REMAIN (${cdnRefs.size}):`);
  for (const [url, files] of cdnRefs) {
    console.log(`  ${url} [${files.size} file(s)]`);
  }
} else {
  console.log("No Squarespace references in output.");
}
for (
  const f of [
    ".nojekyll",
    "robots.txt",
    "sitemap.xml",
    "404.html",
    "css/site.css",
    "js/contact-form.js",
  ]
) {
  if (!exists(ROOT + f)) {
    ok = false;
    console.log(`MISSING FILE: ${f}`);
  }
}
if (!ok) Deno.exit(1);
console.log("Check passed.");
