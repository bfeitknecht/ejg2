/**
 * Client island: upgrades the server-rendered contact form to AJAX submission
 * and provides the homepage "Contact" modal.
 *
 * Bundled with esbuild to js/contact-form.js (see tools/build.ts).
 */
import { hydrate, render } from "preact";
import { ContactForm } from "../components/ContactForm.ts";
import { html } from "../html.ts";

function propsFrom(el: Element) {
  return {
    endpoint: el.getAttribute("data-endpoint") || "",
    email: el.getAttribute("data-email") || "",
  };
}

// 1. Inline form (contact page): hydrate the server-rendered markup.
const inline = document.getElementById("contact-form");
if (inline) {
  hydrate(html`<${ContactForm} ...${propsFrom(inline)} />`, inline);
}

// 2. Homepage: the Contact button opens the same form in a modal.
const trigger = document.querySelector<HTMLElement>("[data-contact-modal]");
if (trigger) {
  const props = propsFrom(trigger);
  let open = false;

  function close() {
    open = false;
    document.getElementById("contact-modal")?.remove();
    document.documentElement.classList.remove("modal-open");
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }

  function show() {
    if (open) return;
    open = true;
    const wrap = document.createElement("div");
    wrap.id = "contact-modal";
    wrap.innerHTML =
      '<div class="modal-backdrop"></div><div class="modal-panel" role="dialog" aria-modal="true" aria-label="Contact"><button class="modal-close" aria-label="Close">×</button><div class="modal-mount"></div></div>';
    document.body.appendChild(wrap);
    wrap.querySelector(".modal-backdrop")?.addEventListener("click", close);
    wrap.querySelector(".modal-close")?.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("modal-open");
    const mount = wrap.querySelector(".modal-mount")!;
    render(html`<${ContactForm} ...${props} />`, mount);
    (wrap.querySelector("input[name=name]") as HTMLInputElement | null)
      ?.focus();
  }

  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    show();
  });
}
