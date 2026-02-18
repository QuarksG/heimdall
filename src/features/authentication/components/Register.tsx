// src/features/authentication/components/Register.tsx
// NOTE: This is the SIGN-UP form (pre-login). The post-login "Access Request"
//       form is in AccessRequest.tsx.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { signUp } from "aws-amplify/auth";
import AuthLayout from "./AuthLayout";
import "../styles/auth.css";

const SS = {
  termsAccepted: "heimdall.termsAccepted",
  acceptanceId: "heimdall.acceptanceId",
  termsVersion: "heimdall.termsVersion",
};

function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/* ─── Password strength ─── */
type StrengthLevel = "weak" | "fair" | "good" | "strong";

function getPasswordStrength(pw: string): {
  score: number;
  level: StrengthLevel;
  label: string;
} {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 2) return { score, level: "weak", label: "Weak" };
  if (score === 3) return { score, level: "fair", label: "Fair" };
  if (score === 4) return { score, level: "good", label: "Good" };
  return { score, level: "strong", label: "Strong" };
}

function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const { score, level, label } = getPasswordStrength(password);
  const bars = 4;

  return (
    <div>
      <div className="auth-password-strength">
        {Array.from({ length: bars }, (_, i) => (
          <div
            key={i}
            className={`auth-strength-bar ${i < score ? `auth-strength-bar--filled-${level}` : ""}`}
          />
        ))}
      </div>
      <div className={`auth-strength-label auth-strength-label--${level}`}>
        {label}
        {level === "weak" && " \u2014 Use 8+ chars, upper, lower, number, symbol"}
      </div>
    </div>
  );
}

export default function Register() {
  const nav = useNavigate();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Guard: must accept terms first
  useEffect(() => {
    const accepted =
      sessionStorage.getItem(SS.termsAccepted) === "true";
    if (!accepted) nav("/auth/terms", { replace: true });
  }, [nav]);

  const fullName = useMemo(
    () => `${firstName.trim()} ${lastName.trim()}`.trim(),
    [firstName, lastName],
  );

  const canSubmit = useMemo(() => {
    if (busy) return false;
    if (!firstName.trim()) return false;
    if (!lastName.trim()) return false;
    if (!isEmail(email)) return false;
    if (password.length < 8) return false;
    if (password !== confirmPassword) return false;
    return true;
  }, [busy, firstName, lastName, email, password, confirmPassword]);

  return (
    <AuthLayout
      title="Sign up"
      subtitle="Create an account with your corporate email"
    >
      <div className="auth-form">
        <div className="auth-field-row">
          <div className="auth-field">
            <label className="auth-label">First name</label>
            <input
              className={`auth-input ${firstName && !firstName.trim() ? "auth-input--error" : ""}`}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Jane"
              autoComplete="given-name"
            />
          </div>

          <div className="auth-field">
            <label className="auth-label">Last name</label>
            <input
              className={`auth-input ${lastName && !lastName.trim() ? "auth-input--error" : ""}`}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Doe"
              autoComplete="family-name"
            />
          </div>
        </div>

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
              className={`auth-input ${password && password.length < 8 ? "auth-input--error" : ""}`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              type={showPass ? "text" : "password"}
              autoComplete="new-password"
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
          <PasswordStrength password={password} />
        </div>

        <div className="auth-field">
          <label className="auth-label">Confirm password</label>
          <input
            className={`auth-input ${confirmPassword && confirmPassword !== password ? "auth-input--error" : ""}`}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat password"
            type={showPass ? "text" : "password"}
            autoComplete="new-password"
          />
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
            onClick={() => nav("/auth/login")}
          >
            Already have an account? Sign In
          </button>

          <button
            type="button"
            className="auth-btn auth-btn--link"
            onClick={() => nav("/auth/forgot")}
          >
            Forgot password?
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
              await signUp({
                username: email,
                password,
                options: {
                  userAttributes: {
                    email,
                    given_name: firstName.trim(),
                    family_name: lastName.trim(),
                    name: fullName,
                  },
                  clientMetadata: {
                    acceptanceId,
                    termsVersion,
                  },
                  // Prevent Amplify from starting auto-sign-in flow
                  autoSignIn: false,
                },
              });

              nav("/auth/confirm", { state: { email } });
            } catch (e: unknown) {
              console.error("[Register] signUp error:", e);
              const name = String(
                (e as { name?: string })?.name ?? "",
              );
              if (name === "UsernameExistsException") {
                setErr(
                  "An account already exists for this email. Sign in instead.",
                );
              } else if (name === "InvalidPasswordException") {
                setErr(
                  "Password does not meet requirements. Use at least 8 characters with upper, lower, number, and symbol.",
                );
              } else if (name === "InvalidParameterException") {
                setErr(
                  "Invalid input. Check your email and try again.",
                );
              } else {
                setErr("Sign-up failed. Try again.");
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <>
              <span className="auth-spinner" /> Creating&hellip;
            </>
          ) : (
            "Create account"
          )}
        </button>

        <div className="auth-footer">
          <p>
            <button
              type="button"
              className="auth-btn--link"
              onClick={() => nav("/auth/terms")}
            >
              View Terms(it is required to accept it)
            </button>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}