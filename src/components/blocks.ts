import type { Block, SiteContent } from "../content.ts";
import { ContactForm } from "./ContactForm.ts";
import { html } from "../html.ts";

function isExternal(href: string) {
  return /^https?:\/\//.test(href);
}

export function BlockRenderer(
  { block, site }: { block: Block; site: SiteContent },
) {
  switch (block.type) {
    case "richtext":
      return html`<div class="richtext" dangerouslySetInnerHTML=${{
        __html: block.html,
      }} />`;

    case "image": {
      const img = html`
        <img
          src=${block.src}
          alt=${block.alt}
          width=${block.width}
          height=${block.height}
          loading="lazy"
        />
      `;
      const external = block.href ? isExternal(block.href) : false;
      return html`<figure class="block-image">
        ${
        block.href &&
        html`
          <a
            href=${block.href}
            target=${external ? "_blank" : undefined}
            rel=${external ? "noopener" : undefined}
          >${img}</a>
        `
      }
        ${!block.href && img}
        ${block.caption && html`<figcaption>${block.caption}</figcaption>`}
      </figure>`;
    }

    case "gallery":
      return html`<div class="block-gallery">
        ${
        block.images.map(
          (im) =>
            html`
              <a key=${im.src} class="gallery-item" href=${im
                .src} target="_blank"
                rel="noopener">
                <img src=${im.src} alt=${im.alt} width=${im.width} height=${im
                  .height}
                  loading="lazy" />
              </a>
            `,
        )
      }
      </div>`;

    case "embed": {
      const src = block.provider === "youtube"
        ? `https://www.youtube-nocookie.com/embed/${block.id}?rel=0`
        : `https://player.vimeo.com/video/${block.id}`;
      return html`<figure class="block-embed">
        <iframe
          src=${src}
          title=${block.title || "Embedded video"}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen=${true}
        ></iframe>
        ${block.title && html`<figcaption>${block.title}</figcaption>`}
      </figure>`;
    }

    case "button": {
      const external = isExternal(block.href);
      return html`
        <p class="block-button">
          <a
            class="button"
            href=${block.href}
            target=${external ? "_blank" : undefined}
            rel=${external ? "noopener" : undefined}
          >
                  ${block.label}
                </a>
        </p>
      `;
    }

    case "hr":
      return html`<hr class="block-hr" />`;

    case "contact-form":
      return html`
        <div id="contact-form" data-endpoint=${site
          .formEndpoint} data-email=${site.email}>
          <${ContactForm} endpoint=${site.formEndpoint} email=${site.email} />
        </div>
      `;

    default:
      return null;
  }
}

export function Blocks(
  { blocks, site }: { blocks: Block[]; site: SiteContent },
) {
  return html`${
    blocks.map((b, i) =>
      html`<${BlockRenderer} key=${i} block=${b} site=${site} />`
    )
  }`;
}
