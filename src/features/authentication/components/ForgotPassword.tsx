// src/features/authentication/components/ForgotPassword.tsx
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { confirmResetPassword, resetPassword } from "aws-amplify/auth";
import AuthLayout from "./AuthLayout";
import "../styles/auth.css";

function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default function ForgotPassword() {
  const nav = useNavigate();

  const [step, setStep] = useState<"request" | "confirm">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [busy, setBusy] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [rate, setRate] = useState("Limit: 3/month");

  const canSend = useMemo(
    () => isEmail(email) && !busy,
    [email, busy],
  );

  const canConfirm = useMemo(() => {
    if (busy) return false;
    if (!isEmail(email)) return false;
    if (!code.trim()) return false;
    if (newPass.length < 8) return false;
    if (newPass !== confirmPass) return false;
    return true;
  }, [busy, email, code, newPass, confirmPass]);

  return (
    <AuthLayout
      title="Forgot password"
      subtitle="Send a reset code, then set a new password"
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

        {step === "request" ? (
          <>
            {err ? (
              <div
                className="auth-alert auth-alert--error"
                role="alert"
              >
                <div>{err}</div>
              </div>
            ) : null}

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
                onClick={() => nav("/auth/login")}
              >
                Back to Sign In
              </button>
              <span className="auth-rate-limit">{rate}</span>
            </div>

            <button
              type="button"
              className="auth-btn auth-btn--primary"
              disabled={!canSend}
              onClick={async () => {
                setErr(null);
                setBusy(true);
                try {
                  await resetPassword({ username: email });
                  setStep("confirm");
                  setRate("Code sent. Limit: 3/month");
                } catch {
                  setErr(
                    "Could not send reset code. Try again later.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? (
                <>
                  <span className="auth-spinner" /> Sending&hellip;
                </>
              ) : (
                "Send reset code"
              )}
            </button>
          </>
        ) : (
          <>
            <div className="auth-field">
              <label className="auth-label">Reset code</label>
              <input
                className="auth-input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Enter code"
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </div>

            <div className="auth-field">
              <label className="auth-label">New password</label>
              <input
                className={`auth-input ${newPass && newPass.length < 8 ? "auth-input--error" : ""}`}
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                placeholder="Minimum 8 characters"
                type="password"
                autoComplete="new-password"
              />
            </div>

            <div className="auth-field">
              <label className="auth-label">
                Confirm new password
              </label>
              <input
                className={`auth-input ${confirmPass && confirmPass !== newPass ? "auth-input--error" : ""}`}
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                placeholder="Repeat password"
                type="password"
                autoComplete="new-password"
              />
            </div>

            {err ? (
              <div
                className="auth-alert auth-alert--error"
                role="alert"
              >
                <div>{err}</div>
              </div>
            ) : null}

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
                    await resetPassword({ username: email });
                    setRate("Code resent. Limit: 3/month");
                  } catch {
                    setErr("Resend failed. Try again later.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Resend code
              </button>
              <span className="auth-rate-limit">{rate}</span>
            </div>

            <button
              type="button"
              className="auth-btn auth-btn--primary"
              disabled={!canConfirm}
              onClick={async () => {
                setErr(null);
                setBusy(true);
                try {
                  await confirmResetPassword({
                    username: email,
                    confirmationCode: code.trim(),
                    newPassword: newPass,
                  });
                  nav("/auth/login", { state: { email } });
                } catch {
                  setErr(
                    "Reset failed. Check the code and try again.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? (
                <>
                  <span className="auth-spinner" /> Updating&hellip;
                </>
              ) : (
                "Set new password"
              )}
            </button>

            <button
              type="button"
              className="auth-btn auth-btn--ghost"
              onClick={() => {
                setErr(null);
                setCode("");
                setNewPass("");
                setConfirmPass("");
                setStep("request");
              }}
            >
              Start over
            </button>
          </>
        )}
      </div>
    </AuthLayout>
  );
}