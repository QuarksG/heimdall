// src/features/authentication/components/Login.tsx
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { signIn } from "aws-amplify/auth";
import AuthLayout from "./AuthLayout";
import { useAuth } from "../context/AuthContext";
import "../styles/auth.css";

const SS = {
  termsAccepted: "heimdall.termsAccepted",
  acceptanceId: "heimdall.acceptanceId",
  termsVersion: "heimdall.termsVersion",
};

/** Typed route state passed from Register / ConfirmSignUp */
type LocationState = { email?: string } | null;

function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const locState = loc.state as LocationState;
  const { refresh } = useAuth();

  const [email, setEmail] = useState<string>(locState?.email ?? "");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Terms acceptance is only required for sign-up, not sign-in.
  // Returning users who already registered have accepted terms during sign-up.

  const canSubmit = useMemo(
    () => isEmail(email) && password.length >= 1 && !busy,
    [email, password, busy],
  );

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use your corporate email to continue"
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
          <label className="auth-label">Password</label>

          <div className="auth-password-wrapper">
            <input
              className="auth-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              type={showPass ? "text" : "password"}
              autoComplete="current-password"
            />
            <button
              type="button"
              className="auth-password-toggle"
              onClick={() => setShowPass((v) => !v)}
              aria-label={showPass ? "Hide password" : "Show password"}
            >
              {showPass ? "\u25C9" : "\u25CB"}
            </button>
          </div>
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
            onClick={() => nav("/auth/forgot")}
          >
            Forgot password?
          </button>

          <button
            type="button"
            className="auth-btn auth-btn--link"
            onClick={() => nav("/auth/register")}
          >
            Sign up
          </button>
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

            const acceptanceId =
              sessionStorage.getItem(SS.acceptanceId) ?? "";
            const termsVersion =
              sessionStorage.getItem(SS.termsVersion) ?? "";

            try {
              await signIn({
                username: email,
                password,
                options: {
                  clientMetadata: { acceptanceId, termsVersion },
                },
              });

              await refresh();
              nav("/", { replace: true });
            } catch (e: unknown) {
              const name = String(
                (e as { name?: string })?.name ?? "",
              );
              if (name === "UserNotConfirmedException") {
                nav("/auth/confirm", { state: { email } });
              } else if (name === "NotAuthorizedException") {
                setErr("Incorrect email or password.");
              } else if (name === "UserNotFoundException") {
                setErr("No account found for this email.");
              } else {
                setErr("Sign-in failed. Try again.");
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <>
              <span className="auth-spinner" /> Signing in&hellip;
            </>
          ) : (
            "Sign in"
          )}
        </button>

        <div className="auth-footer">
          <p>
            <button
              type="button"
              className="auth-btn--link"
              onClick={() => nav("/auth/terms")}
            >
              View Terms
            </button>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}