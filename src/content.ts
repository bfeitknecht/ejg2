/** Shared content types + loaders for the build. */

export interface SiteContent {
  title: string;
  tagline: string;
  description: string;
  logo: string;
  favicon: string;
  coverBackground: string;
  email: string;
  address: string[];
  nav: { label: string; href: string }[];
  formEndpoint: string;
}

export type Block =
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
  | { type: "embed"; provider: string; id: string; title?: string }
  | { type: "button"; label: string; href: string }
  | { type: "hr" }
  | { type: "contact-form" };

export interface ImageRef {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

export interface PageContent {
  path: string;
  title: string;
  description: string;
  layout: "cover" | "page" | "gallery" | "post" | "hub" | "contact";
  blocks?: Block[];
  images?: ImageRef[];
  embeds?: { provider: string; id: string; title?: string }[];
  cards?: { label: string; href: string; img: string }[];
  logo?: string;
  background?: string;
  date?: string;
  category?: string;
  tags?: string[];
}

export const CONTENT_DIR = new URL("../src/content/", import.meta.url).pathname;

export async function loadSite(): Promise<SiteContent> {
  return JSON.parse(await Deno.readTextFile(CONTENT_DIR + "site.json"));
}

export async function loadPages(): Promise<PageContent[]> {
  const pages: PageContent[] = [];
  for await (const f of Deno.readDir(CONTENT_DIR + "pages")) {
    if (f.name.endsWith(".json")) {
      pages.push(
        JSON.parse(await Deno.readTextFile(CONTENT_DIR + "pages/" + f.name)),
      );
    }
  }
  return pages.sort((a, b) => a.path.localeCompare(b.path));
}

/** First image + short text excerpt of a page, for listing cards. */
export function summarize(
  page: PageContent,
): { img?: string; excerpt: string } {
  let img: string | undefined;
  let excerpt = "";
  for (const b of page.blocks || []) {
    if (!img && b.type === "image") img = b.src;
    if (!excerpt && b.type === "richtext") {
      excerpt = b.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }
    if (img && excerpt) break;
  }
  if (!excerpt) excerpt = page.description || "";
  if (excerpt.length > 180) {
    excerpt = excerpt.slice(0, 177).replace(/\s+\S*$/, "") + "…";
  }
  return { img, excerpt };
}
