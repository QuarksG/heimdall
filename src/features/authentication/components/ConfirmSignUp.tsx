// src/features/authentication/components/ConfirmSignUp.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { confirmSignUp, resendSignUpCode } from "aws-amplify/auth";
import AuthLayout from "./AuthLayout";
import "../styles/auth.css";

type LocationState = { email?: string } | null;

function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function joinDigits(d: string[]) {
  return d.join("");
}

export default function ConfirmSignUp() {
  const nav = useNavigate();
  const loc = useLocation();
  const locState = loc.state as LocationState;

  const [email, setEmail] = useState<string>(locState?.email ?? "");
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string>("Limit: 3/month");

  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const code = useMemo(() => joinDigits(digits), [digits]);
  const canSubmit = useMemo(
    () => isEmail(email) && /^\d{6}$/.test(code) && !busy,
    [email, code, busy],
  );

  useEffect(() => {
    inputsRef.current?.[0]?.focus();
  }, []);

  function setDigit(i: number, v: string) {
    const next = v.replace(/\D/g, "").slice(0, 1);
    setDigits((prev) => {
      const cp = [...prev];
      cp[i] = next;
      return cp;
    });
    if (next && i < 5) inputsRef.current?.[i + 1]?.focus();
  }

  function onBackspace(i: number) {
    setDigits((prev) => {
      const cp = [...prev];
      if (cp[i]) {
        cp[i] = "";
      } else if (i > 0) {
        cp[i - 1] = "";
        inputsRef.current?.[i - 1]?.focus();
      }
      return cp;
    });
  }

  return (
    <AuthLayout
      title="Verify email"
      subtitle="Enter the 6-digit code sent to your email"
    >
      <div className="auth-form">
        <div className="auth-field">
          <label className="auth-label">Email</label>
          <input
            className={`auth-input ${email && !isEmail(email) ? "auth-input--error" : ""}`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@amazon.com"
            autoComplete="email"
          />
        </div>

        <div className="auth-field">
          <label className="auth-label">Verification code</label>

          <div className="auth-otp-group" aria-label="OTP code">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputsRef.current[i] = el;
                }}
                className="auth-otp-input"
                value={d}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Backspace") {
                    e.preventDefault();
                    onBackspace(i);
                  }
                  if (e.key === "ArrowLeft" && i > 0)
                    inputsRef.current?.[i - 1]?.focus();
                  if (e.key === "ArrowRight" && i < 5)
                    inputsRef.current?.[i + 1]?.focus();
                }}
                inputMode="numeric"
                aria-label={`Digit ${i + 1}`}
              />
            ))}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <button
              type="button"
              className="auth-btn auth-btn--link"
              onClick={async () => {
                setErr(null);
                setBusy(true);
                try {
                  await resendSignUpCode({ username: email });
                  setInfo("Code resent. Limit: 3/month");
                } catch {
                  setErr("Resend failed. Try again later.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Resend verification code
            </button>

            <span className="auth-rate-limit">{info}</span>
          </div>
        </div>

        {err ? (
          <div className="auth-alert auth-alert--error" role="alert">
            <div>{err}</div>
          </div>
        ) : null}

        <button
          type="button"
          className="auth-btn auth-btn--primary"
          disabled={!canSubmit}
          onClick={async () => {
            setErr(null);
            setBusy(true);
            try {
              await confirmSignUp({
                username: email,
                confirmationCode: code,
              });
              nav("/auth/login", { state: { email } });
            } catch {
              setErr(
                "Verification failed. Check the code and try again.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <>
              <span className="auth-spinner" /> Confirming&hellip;
            </>
          ) : (
            "Confirm"
          )}
        </button>

        <div className="auth-footer">
          <p>
            <button
              type="button"
              className="auth-btn--link"
              onClick={() =>
                nav("/auth/login", { state: { email } })
              }
            >
              Back to Sign In
            </button>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}