// src/features/authentication/components/FeatureToggle.tsx
import "../styles/feature-toggle.css";

/**
 * Presentation-only macOS System Settings-style switch (Req 3.7).
 * Serves both the UserCard and RequestHistory surfaces (Req 3.12) —
 * no data fetching; state and persistence live in the parent.
 */
export type FeatureToggleProps = {
  featureId: string;
  label: string;
  checked: boolean;
  /** Req 3.5 — while a change persists: control disabled, spinner shown. */
  pending: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
};

export default function FeatureToggle({
  featureId,
  label,
  checked,
  pending,
  disabled = false,
  onChange,
}: FeatureToggleProps) {
  const isDisabled = pending || disabled;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={pending || undefined}
      data-feature-id={featureId}
      disabled={isDisabled}
      className={[
        "ft-switch",
        checked ? "ft-switch--on" : "ft-switch--off",
        pending ? "ft-switch--pending" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      // Native <button> click fires on Space AND Enter, so keyboard
      // activation (Req 3.8) is covered without extra key handlers.
      onClick={() => onChange(!checked)}
    >
      <span className="ft-track" aria-hidden="true">
        {pending ? (
          <span className="ft-spinner" data-testid="ft-spinner" />
        ) : (
          <span className="ft-thumb" />
        )}
      </span>
    </button>
  );
}
