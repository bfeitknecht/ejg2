#!/usr/bin/env -S deno run --allow-read
/** Verify the mirror: every local asset reference in HTML/CSS must resolve to a file.
 *  Reports un-rewritten Squarespace CDN references and leftover root-relative refs. */

const ROOT = new URL("../", import.meta.url).pathname;
const missing = new Set<string>();
const cdnRefs = new Map<string, Set<string>>();
let rootRelative = 0;

function* walk(dir: string): Generator<string> {
  for (const e of Deno.readDirSync(dir)) {
    const p = dir + "/" + e.name;
    if (e.isDirectory) yield* walk(p);
    else yield p;
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

function resolve(dir: string, ref: string): string {
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
  if (ref.startsWith("?") || ref.startsWith("#")) return; // query/filter links
  if (ref.startsWith("/")) {
    rootRelative++;
    return;
  }
  ref = ref.split("?")[0].split("#")[0]; // strip query/fragment (font.eot?#iefix)
  if (!exists(resolve(dir, ref))) missing.add(`${file} -> ${ref}`);
}

for (const f of walk(ROOT)) {
  if (!/\.(html|css)$/.test(f) || f.includes("/tools/")) continue;
  const rel = f.slice(ROOT.length);
  const dir = rel.slice(0, rel.lastIndexOf("/"));
  const text = await Deno.readTextFile(f);

  for (
    const m of text.matchAll(
      /(?:src|href|data-src|data-image|poster)=["']([^"']+)["']/g,
    )
  ) {
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
  if (f.endsWith(".html")) {
    for (
      const m of text.matchAll(
        /(?:https?:)?\/\/(?:assets\.squarespace\.com|static1\.squarespace\.com|images\.squarespace-cdn\.com|file\.squarespace-cdn\.com)\/[^\s"'<>\\()]+/g,
      )
    ) {
      const set = cdnRefs.get(m[0]) ?? new Set();
      set.add(rel);
      cdnRefs.set(m[0], set);
    }
  }
}

console.log(
  missing.size === 0
    ? "All local references resolve."
    : `MISSING (${missing.size}):`,
);
for (const m of missing) console.log("  " + m);
console.log(`Root-relative refs (fine on the custom domain): ${rootRelative}`);
console.log(
  cdnRefs.size === 0
    ? "No un-rewritten Squarespace CDN refs in HTML."
    : `Un-rewritten CDN refs (${cdnRefs.size}):`,
);
for (const [url, files] of cdnRefs) {
  console.log(`  ${url}  [in ${files.size} page(s)]`);
}
