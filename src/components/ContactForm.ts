import { h } from "preact";
import { useState } from "preact/hooks";
import { html } from "../html.ts";

export interface ContactFormProps {
  endpoint: string;
  email: string;
}

type Status = "idle" | "sending" | "sent" | "error";

/**
 * Contact form. Server-rendered with a native POST fallback (works without
 * JavaScript); the client island upgrades it to an AJAX submission.
 *
 * Endpoint is FormSubmit.co's AJAX API — the very first submission sends a
 * one-time activation email to the target address.
 */
export function ContactForm({ endpoint, email }: ContactFormProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: Event) {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    if ((data.get("_honey") as string)?.length) return; // bot trap
    setStatus("sending");
    setError("");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          _subject: `[ejg2.com] ${data.get("subject")}`,
          message: data.get("message"),
          _honey: data.get("_honey"),
        }),
      });
      const json = await res.json();
      if (json.success === "true" || json.success === true) {
        form.reset();
        setStatus("sent");
      } else {
        setError(json.message || "Something went wrong. Please try again.");
        setStatus("error");
      }
    } catch {
      setError("Network error — please try again, or email me directly.");
      setStatus("error");
    }
  }

  return html`
    <form
      class="contact-form"
      action=${endpoint.replace("/ajax/", "/")}
      method="POST"
      onSubmit=${onSubmit}
    >
      <input type="text" name="_honey" class="hp" tabindex=${-1}
        autocomplete="off" aria-hidden="true" />
      <input type="hidden" name="_captcha" value="false" />
      <div class="field-row">
        <label class="field">
          <span class="field-label">Name</span>
          <input type="text" name="name" required autocomplete="name" />
        </label>
        <label class="field">
          <span class="field-label">Email address</span>
          <input type="email" name="email" required autocomplete="email" />
        </label>
      </div>
      <label class="field">
        <span class="field-label">Subject</span>
        <input type="text" name="subject" required />
      </label>
      <label class="field">
        <span class="field-label">Message</span>
        <textarea name="message" rows=${6} required></textarea>
      </label>
      <div class="form-footer">
          <button type="submit" class="button" disabled=${status === "sending"}>
            ${status === "sending" ? "Sending…" : "Send message"}
          </button>
          ${status === "sent" &&
            html`
              <p class="form-note ok"
                role="status">Thank you — your message is on its way.</p>
            `}
          ${status === "error" &&
            html`<p class="form-note err" role="alert">${error}</p>`}
          <p class="form-note alt">Or email <a href="mailto:${email}">${email}</a> directly.</p>
        </div>
    </form>
  `;
}
