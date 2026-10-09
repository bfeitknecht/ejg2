import type { PageContent, SiteContent } from "../content.ts";
import { summarize } from "../content.ts";
import { Blocks } from "./blocks.ts";
import { Layout } from "./Layout.ts";
import { html } from "../html.ts";

function Card(
  { label, href, img }: { label: string; href: string; img?: string },
) {
  return html`<a class="card" href=${href}>
    ${img && html`<img src=${img} alt=${label} loading="lazy" />`}
    <span class="card-label">${label}</span>
  </a>`;
}

function Cover({ site, page }: { site: SiteContent; page: PageContent }) {
  const background = page.background || site.coverBackground;
  const logo = page.logo || site.logo;
  return html`
    <div class="cover" style=${`background-image:url('${background}')`}>
      <div class="cover-overlay"></div>
      <div class="cover-inner">
        <img class="cover-logo" src=${logo} alt=${site.title} width="360"
          height="114" />
        <p class="cover-tagline">${site.tagline}</p>
        <nav class="cover-nav" aria-label="Cover">
          <a href="/contact/" class="cover-link" data-contact-modal>Contact</a>
          <a href="/projects/" class="cover-link">Projects</a>
          <a href="/letter-to-lucy/" class="cover-link">Book</a>
        </nav>
      </div>
    </div>
  `;
}

function GalleryPage({ site, page }: { site: SiteContent; page: PageContent }) {
  return html`
    <${Layout} site=${site} path=${page.path} title=${page.title}
      description=${page.description}>
      <article class="page">
          <h1 class="page-title">${page.title}</h1>
          ${page.embeds &&
            html`<${Blocks} blocks=${
              page.embeds.map((e) => ({ type: "embed", ...e }))
            } site=${site} />`}
          ${page.images && page.images.length > 0 &&
            html`<div class="gallery-grid">
        ${
              page.images.map(
                (im) =>
                  html`
                    <a key=${im.src} class="gallery-item" href=${im
                      .src} target="_blank"
                      rel="noopener">
                      <img src=${im.src} alt=${im.alt} width=${im
                        .width} height=${im.height}
                        loading="lazy" />
                    </a>
                  `,
              )
            }
      </div>`}
          ${page.blocks &&
            html`<${Blocks} blocks=${page.blocks} site=${site} />`}
        </article>
      <//>
  `;
}

function HubPage({ site, page }: { site: SiteContent; page: PageContent }) {
  return html`
    <${Layout} site=${site} path=${page.path} title=${page.title}
      description=${page.description}>
      <article class="page">
          <h1 class="page-title">${page.title}</h1>
          ${page.description &&
            html`<p class="page-intro">${page.description}</p>`}
          ${page.cards && page.cards.length > 0 && html`<div class="card-grid">
        ${
            page.cards.map((c) =>
              html`
                <${Card} key=${c.href} label=${c.label} href=${c.href}
                  img=${c.img} />
              `
            )
          }
      </div>`}
          ${page.blocks &&
            html`<${Blocks} blocks=${page.blocks} site=${site} />`}
        </article>
      <//>
  `;
}

function PostPage({ site, page }: { site: SiteContent; page: PageContent }) {
  return html`
    <${Layout} site=${site} path=${page.path} title=${page.title}
      description=${page.description}>
      <article class="page post">
          <header class="post-header">
            <h1 class="page-title">${page.title}</h1>
            <p class="post-meta">
              ${page.date &&
                html`<time datetime=${page.date}>${page.date}</time>`}
              ${page.category &&
                html`<span class="post-category"> · ${page.category}</span>`}
            </p>
          </header>
          ${page.blocks &&
            html`<${Blocks} blocks=${page.blocks} site=${site} />`}
          ${page.tags && page.tags.length > 0 &&
            html`<p class="post-tags">${
              page.tags.map((t) => html`<span key=${t} class="tag">${t}</span>`)
            }</p>`}
          <p class="post-back"><a href="/projects/">← All projects</a></p>
        </article>
      <//>
  `;
}

function StandardPage(
  { site, page }: { site: SiteContent; page: PageContent },
) {
  return html`
    <${Layout} site=${site} path=${page.path} title=${page.title}
      description=${page.description}>
      <article class="page">
          <h1 class="page-title">${page.title}</h1>
          ${page.blocks &&
            html`<${Blocks} blocks=${page.blocks} site=${site} />`}
        </article>
      <//>
  `;
}

export function PageRenderer(
  { site, page }: { site: SiteContent; page: PageContent },
) {
  switch (page.layout) {
    case "cover":
      return html`
        <${Layout}
          site=${site}
          path=${page.path}
          title=${page.title}
          description=${page.description}
          cover=${true}
        >
          <${Cover} site=${site} page=${page} />
          <//>
      `;
    case "gallery":
      return html`<${GalleryPage} site=${site} page=${page} />`;
    case "hub":
      return html`<${HubPage} site=${site} page=${page} />`;
    case "post":
      return html`<${PostPage} site=${site} page=${page} />`;
    default:
      return html`<${StandardPage} site=${site} page=${page} />`;
  }
}

/** Generated listing page (e.g. /projects/, /blog/) built from post pages. */
export function ListingPage(
  { site, path, title, description, posts, intro, backLabel, backHref }: {
    site: SiteContent;
    path: string;
    title: string;
    description: string;
    posts: PageContent[];
    intro?: string;
    backLabel?: string;
    backHref?: string;
  },
) {
  return html`
    <${Layout} site=${site} path=${path} title=${title}
      description=${description}>
      <article class="page">
          <h1 class="page-title">${title}</h1>
          ${intro && html`<p class="page-intro">${intro}</p>`}
          <div class="post-list">
            ${posts.map((p) => {
              const { img, excerpt } = summarize(p);
              return html`<a key=${p.path} class="post-card" href=${p.path}>
            ${img && html`<img src=${img} alt="" loading="lazy" />`}
            <span class="post-card-body">
              <span class="post-card-title">${p.title}</span>
              ${p.date && html`<span class="post-card-date">${p.date}</span>`}
              ${
                excerpt &&
                html`<span class="post-card-excerpt">${excerpt}</span>`
              }
            </span>
          </a>`;
            })}
          </div>
          ${backLabel && backHref &&
            html`<p class="post-back"><a href=${backHref}>← ${backLabel}</a></p>`}
        </article>
      <//>
  `;
}
