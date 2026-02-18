import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "./AuthLayout";
import "../styles/auth.css";

import outputs from "../../../../amplify_outputs.json";

const SS = {
  termsAccepted: "heimdall.termsAccepted",
  termsVersion: "heimdall.termsVersion",
  acceptanceId: "heimdall.acceptanceId",
};

const CURRENT_TERMS_VERSION = "TOS_2026_02";

const API_ENDPOINT: string =
  (outputs as any)?.custom?.API?.heimdallHttpApi?.endpoint ?? "";

function safeUuid() {
  const c = globalThis.crypto;
  return typeof c?.randomUUID === "function"
    ? c.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function acceptTerms(): Promise<{ acceptanceId: string; termsVersion: string }> {
  if (!API_ENDPOINT) throw new Error("Terms API endpoint not configured");

  const url = `${API_ENDPOINT.replace(/\/+$/, "")}/onboarding/terms/accept`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      termsVersion: CURRENT_TERMS_VERSION,
      sessionId: safeUuid(),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Terms API returned ${res.status}: ${text}`);
  }

  return (await res.json()) as { acceptanceId: string; termsVersion: string };
}

const TERMS = `
Please read carefully before proceeding with sign-up.

Heimdall is a controlled internal tool intended for authorized staff use only. You must register using your corporate (Amazon) email address. While Heimdall is currently an internal tool, it is being designed with an external-user model in mind; therefore, standard Amazon VPN-based access is not required for this environment.

## Purpose and roadmap

Heimdall is being expanded to support validation of Amazon drop-ship vendors and to address onboarding and invoice compliance needs across multiple Amazon marketplaces. Based on test results and user feedback, we plan to finalize the solution and seek internal approvals to make predefined features available to external users by 2027, subject to scope, risk assessment, and business justification.

## Acceptable use and data handling

By continuing, you agree to:

* Use Heimdall **only for approved operational activities** and in accordance with internal policies.
* **Protect confidential information** and follow internal security, compliance, and data-handling requirements at all times.
* Not upload, process, store, or share any data you are not authorized to handle.
* Not attempt to bypass access controls, misuse the application, or share accounts or credentials.

## Hosting and architecture

Heimdall is hosted on **Amazon AWS cloud infrastructure** and is built on **AWS-native, modular components** to support secure access and future expansion across Amazon marketplaces.

## Monitoring and access management

Use of Heimdall may be monitored and logged for security, compliance, auditing, and operational support. Access may be modified, restricted, or revoked at any time where required for security, compliance, or operational reasons.

## Test environment notice

This environment may be a **test deployment** and is provided **“as-is”**, without warranties or guarantees regarding availability, performance, or outcomes. Functionality may change as the tool evolves. If these terms are updated, you may be required to re-accept them to continue using Heimdall.

## Test user acknowledgement (through 2027)

By using Heimdall, you acknowledge that you are participating as a **test user through 2027**. During this period, we may record and analyze invoice-related errors and operational issues to prevent recurrence and to improve the tool, including updates needed to support **dynamic changes** and evolving requirements. This monitoring is limited to product improvement, compliance, and operational reliability.

## Feedback

Your feedback helps ensure Heimdall is reliable, scalable, and fit for purpose. Please report issues, gaps, and improvement suggestions through approved internal channels.
`.trim();

/** Minimal markdown-ish renderer: headings (##), bullets (*), paragraphs, and **bold**. */
type TermsBlock =
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] };

function parseTerms(text: string): TermsBlock[] {
  const lines = text.split("\n");
  const blocks: TermsBlock[] = [];

  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    const t = paragraph.join(" ").trim();
    if (t) blocks.push({ kind: "p", text: t });
    paragraph = [];
  };

  const flushList = () => {
    if (list.length) blocks.push({ kind: "ul", items: list });
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "h2", text: line.replace(/^##\s+/, "").trim() });
      continue;
    }

    if (line.startsWith("* ")) {
      flushParagraph();
      list.push(line.replace(/^\*\s+/, "").trim());
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}

function renderInlineBold(text: string) {
  // Splits text into plain/bold segments using **...**
  const parts: Array<{ bold: boolean; value: string }> = [];
  const re = /\*\*(.+?)\*\*/g;

  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = re.lastIndex;

    if (start > last) parts.push({ bold: false, value: text.slice(last, start) });
    parts.push({ bold: true, value: m[1] });
    last = end;
  }

  if (last < text.length) parts.push({ bold: false, value: text.slice(last) });

  return parts.map((p, i) =>
    p.bold ? (
      <strong key={i} className="terms-strong">
        {p.value}
      </strong>
    ) : (
      <span key={i}>{p.value}</span>
    ),
  );
}

function TermsContent({ text }: { text: string }) {
  const blocks = useMemo(() => parseTerms(text), [text]);

  return (
    <article className="terms-article" aria-label="Heimdall terms">
      {blocks.map((b, idx) => {
        if (b.kind === "h2") {
          return (
            <h4 key={idx} className="terms-h2">
              {b.text}
            </h4>
          );
        }
        if (b.kind === "ul") {
          return (
            <ul key={idx} className="terms-ul">
              {b.items.map((it, i) => (
                <li key={i} className="terms-li">
                  {renderInlineBold(it)}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={idx} className="terms-p">
            {renderInlineBold(b.text)}
          </p>
        );
      })}
    </article>
  );
}

export default function DisclosurePage() {
  const nav = useNavigate();

  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Optional: require scroll-to-end before enabling acceptance.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);

  const [checked, setChecked] = useState(
    sessionStorage.getItem(SS.termsAccepted) === "true",
  );

  useEffect(() => {
    // If already accepted in this session, don't force scroll gate again.
    if (checked) setScrolledToEnd(true);
  }, [checked]);

  const canContinue = useMemo(
    () => checked && scrolledToEnd && !busy,
    [checked, scrolledToEnd, busy],
  );

  const modeLabel = mode === "signup" ? "Sign Up" : "Sign In";

  return (
    <AuthLayout
      title="Terms & Conditions"
      subtitle={`Review and accept to continue (${CURRENT_TERMS_VERSION})`}
    >
      <div className="terms-card">
        <div className="terms-card-header">
          <div className="terms-title-wrap">
            <div className="terms-title">Heimdall Usage Terms</div>
            <div className="terms-subtitle">
              Internal tool • Test program through 2027 • AWS-hosted
            </div>
          </div>
          <div className="terms-badges">
            <span className="terms-badge">Version: {CURRENT_TERMS_VERSION}</span>
            <span className="terms-badge terms-badge--soft">Internal</span>
          </div>
        </div>

        <div className="terms-callout" role="note">
          <div className="terms-callout-title">Important</div>
          <div className="terms-callout-text">
            Use your corporate (Amazon) email. Do not upload or process data you
            are not authorized to handle. Activity may be logged for security
            and compliance.
          </div>
        </div>

        <div
          ref={scrollRef}
          className="auth-terms-scroll terms-scroll"
          onScroll={(e) => {
            const el = e.currentTarget;
            const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
            if (atEnd) setScrolledToEnd(true);
          }}
        >
          <TermsContent text={TERMS} />

          <div className="terms-divider" />

          <h4 className="terms-h2">Privacy & security</h4>
          <p className="terms-p">
            Treat all processed data as confidential. Do not copy data outside
            approved systems. Report suspected misuse or access issues to the
            admin team.
          </p>

          <h4 className="terms-h2">Changes</h4>
          <p className="terms-p">
            Updated terms may require re-acceptance before continuing to use
            Heimdall.
          </p>
        </div>

        {!scrolledToEnd ? (
          <div className="terms-scroll-hint" aria-live="polite">
            Scroll to the end to enable acceptance.
          </div>
        ) : null}
      </div>

      <div className="terms-actions">
        <label className="auth-checkbox-wrapper">
          <input
            className="auth-checkbox"
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            disabled={busy || !scrolledToEnd}
          />
          <span className="auth-checkbox-label">
            I accept the terms and conditions
            <span className="terms-mini"> (required to continue)</span>
          </span>
        </label>

        <div className="terms-mode">
          <button
            type="button"
            className={`terms-seg ${mode === "signup" ? "terms-seg--active" : ""}`}
            onClick={() => setMode("signup")}
            aria-pressed={mode === "signup"}
            disabled={busy}
          >
            Sign Up
          </button>
          <button
            type="button"
            className={`terms-seg ${mode === "signin" ? "terms-seg--active" : ""}`}
            onClick={() => setMode("signin")}
            aria-pressed={mode === "signin"}
            disabled={busy}
          >
            Sign In
          </button>
        </div>

        {err ? (
          <div className="auth-alert auth-alert--error" role="alert">
            <div className="terms-error-title">Could not record acceptance</div>
            <div className="terms-error-text">{err}</div>
          </div>
        ) : null}

        <button
          type="button"
          className="auth-btn auth-btn--primary terms-cta"
          disabled={!canContinue}
          onClick={async () => {
            setErr(null);
            setBusy(true);

            try {
              const proof = await acceptTerms();

              sessionStorage.setItem(SS.termsAccepted, "true");
              sessionStorage.setItem(SS.termsVersion, proof.termsVersion);
              sessionStorage.setItem(SS.acceptanceId, proof.acceptanceId);

              nav(mode === "signup" ? "/auth/register" : "/auth/login");
            } catch (e: any) {
              // Safer fallback: only allow local acceptance in dev mode.
              const isDev =
                (typeof import.meta !== "undefined" &&
                  (import.meta as any).env?.MODE === "development") ||
                process.env.NODE_ENV === "development";

              if (!isDev) {
                setErr(
                  "Acceptance service is unavailable. Please try again later or contact the admin team.",
                );
                return;
              }

              console.warn(
                "[DisclosurePage] Terms API unavailable (dev fallback to local acceptance):",
                e,
              );

              const fallbackId = `local-${safeUuid()}`;
              sessionStorage.setItem(SS.termsAccepted, "true");
              sessionStorage.setItem(SS.termsVersion, CURRENT_TERMS_VERSION);
              sessionStorage.setItem(SS.acceptanceId, fallbackId);

              nav(mode === "signup" ? "/auth/register" : "/auth/login");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <>
              <span className="auth-spinner" /> Continuing&hellip;
            </>
          ) : (
            `Continue to ${modeLabel}`
          )}
        </button>

        <div className="auth-footer">
          <p>Authorized test users only • Terms acceptance required</p>
        </div>
      </div>
    </AuthLayout>
  );
}
