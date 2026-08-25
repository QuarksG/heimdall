// Unit tests for the FeatureToggle switch component created in task 8.1.
// Covers accessibility (switch role, aria-checked, Tab focus, Space/Enter
// activation), the pending state (disabled + spinner, no onChange), and
// the on/off visual classes.
//
// **Validates: Requirements 3.5, 3.7, 3.8**

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeatureToggle, { type FeatureToggleProps } from "../FeatureToggle";

function renderToggle(overrides: Partial<FeatureToggleProps> = {}) {
  const onChange = vi.fn();
  const props: FeatureToggleProps = {
    featureId: "reports",
    label: "Reports",
    checked: false,
    pending: false,
    onChange,
    ...overrides,
  };
  render(<FeatureToggle {...props} />);
  return { onChange, toggle: screen.getByRole("switch") };
}

/* ─── Switch role and state exposure (Req 3.8) ─── */

describe("switch role and aria-checked (Req 3.8)", () => {
  it("renders a switch whose accessible name comes from the label prop", () => {
    const { toggle } = renderToggle({ label: "Payment Reconciliation" });
    expect(toggle.getAttribute("aria-label")).toBe("Payment Reconciliation");
  });

  it("exposes aria-checked='true' when checked", () => {
    const { toggle } = renderToggle({ checked: true });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("exposes aria-checked='false' when unchecked", () => {
    const { toggle } = renderToggle({ checked: false });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });
});

/* ─── Keyboard interaction (Req 3.8) ─── */

describe("keyboard interaction (Req 3.8)", () => {
  it("is focusable via the Tab key", async () => {
    const user = userEvent.setup();
    const { toggle } = renderToggle();

    await user.tab();

    expect(document.activeElement).toBe(toggle);
  });

  it("Space activates and calls onChange with the negated value (off -> on)", async () => {
    const user = userEvent.setup();
    const { toggle, onChange } = renderToggle({ checked: false });

    toggle.focus();
    await user.keyboard(" ");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("Space activates and calls onChange with the negated value (on -> off)", async () => {
    const user = userEvent.setup();
    const { toggle, onChange } = renderToggle({ checked: true });

    toggle.focus();
    await user.keyboard(" ");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("Enter also activates and calls onChange with the negated value", async () => {
    const user = userEvent.setup();
    const { toggle, onChange } = renderToggle({ checked: false });

    toggle.focus();
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

/* ─── Pending state (Req 3.5) ─── */

describe("pending state (Req 3.5)", () => {
  it("disables the control and shows the spinner while pending", () => {
    const { toggle } = renderToggle({ pending: true });

    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(toggle.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByTestId("ft-spinner")).toBeTruthy();
  });

  it("hides the spinner when not pending", () => {
    renderToggle({ pending: false });
    expect(screen.queryByTestId("ft-spinner")).toBeNull();
  });

  it("clicks do not fire onChange while pending", async () => {
    const user = userEvent.setup();
    const { toggle, onChange } = renderToggle({ pending: true });

    await user.click(toggle);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("keyboard activation does not fire onChange while pending", async () => {
    const user = userEvent.setup();
    const { toggle, onChange } = renderToggle({ pending: true });

    // A disabled button is removed from the tab order; Tab must skip it.
    await user.tab();
    expect(document.activeElement).not.toBe(toggle);

    // Even with keys sent directly at the element, nothing may fire.
    await user.keyboard(" {Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the disabled prop alone also disables the control without a spinner", () => {
    const { toggle } = renderToggle({ disabled: true });

    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("ft-spinner")).toBeNull();
  });
});

/* ─── On/off visual classes (Req 3.7) ─── */

describe("on/off visual classes (Req 3.7)", () => {
  it("applies ft-switch--on (and not --off) when checked", () => {
    const { toggle } = renderToggle({ checked: true });

    expect(toggle.classList.contains("ft-switch")).toBe(true);
    expect(toggle.classList.contains("ft-switch--on")).toBe(true);
    expect(toggle.classList.contains("ft-switch--off")).toBe(false);
  });

  it("applies ft-switch--off (and not --on) when unchecked", () => {
    const { toggle } = renderToggle({ checked: false });

    expect(toggle.classList.contains("ft-switch")).toBe(true);
    expect(toggle.classList.contains("ft-switch--off")).toBe(true);
    expect(toggle.classList.contains("ft-switch--on")).toBe(false);
  });

  it("applies ft-switch--pending while pending", () => {
    const { toggle } = renderToggle({ pending: true });
    expect(toggle.classList.contains("ft-switch--pending")).toBe(true);
  });

  it("omits ft-switch--pending when not pending", () => {
    const { toggle } = renderToggle({ pending: false });
    expect(toggle.classList.contains("ft-switch--pending")).toBe(false);
  });
});
