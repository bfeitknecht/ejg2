import type { SiteContent } from "../content.ts";
import { html } from "../html.ts";

interface HeadProps {
  site: SiteContent;
  path: string;
  title: string;
  description: string;
}

export function Head({ site, path, title, description }: HeadProps) {
  const canonical = "https://www.ejg2.com" + path;
  return html`<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    ${description && html`<meta name="description" content=${description} />`}
    <link rel="canonical" href=${canonical} />
    <link rel="icon" href=${site.favicon} />
    <meta property="og:site_name" content=${site.title} />
    <meta property="og:title" content=${title} />
    <meta property="og:url" content=${canonical} />
    <meta property="og:description" content=${
    description || site.description
  } />
    <meta name="twitter:card" content="summary" />
    <link rel="stylesheet" href="/css/site.css" />
    <script type="module" src="/js/contact-form.js" defer></script>
  </head>`;
}

export function Header({ site }: { site: SiteContent }) {
  return html`
    <header class="site-header">
      <a class="site-logo" href="/">
        <img src=${site.logo} alt=${site.title} width="180" height="57" />
      </a>
      <nav class="site-nav" aria-label="Main">
          ${site.nav.map((item) =>
            html`<a key=${item.href} href=${item.href}>${item.label}</a>`
          )}
        </nav>
    </header>
  `;
}

export function Footer({ site }: { site: SiteContent }) {
  const year = new Date().getFullYear();
  return html`
    <footer class="site-footer">
      <div class="footer-inner">
        <p class="footer-brand">${site.title} — <em>${site.tagline}</em></p>
        <p class="footer-address">${site.address.join(" · ")}</p>
        <p class="footer-contact"><a href="mailto:${site.email}">${site
          .email}</a></p>
        <p class="footer-copy">© ${year} ${site.title}</p>
      </div>
    </footer>
  `;
}

interface LayoutProps {
  site: SiteContent;
  path: string;
  title: string;
  description: string;
  /** Cover pages render their own full-bleed layout without the standard header. */
  cover?: boolean;
  children?: unknown;
}

export function Layout(
  { site, path, title, description, cover, children }: LayoutProps,
) {
  return html`
    <html lang="en-US">
      <${Head} site=${site} path=${path} title=${title}
        description=${description} />
      <body class=${cover ? "is-cover" : ""}>
          ${cover ? children : html`
            <${Header} site=${site} />
            <main class="site-main">${children}</main>
            <${Footer} site=${site} />
          `}
        </body>
    </html>
  `;
}
