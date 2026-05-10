// src/assets/icons/InvoiceCheckIcon.tsx
import { useId } from "react";
import type { IconProps } from "./Icon";

/**
 * Filled "invoice with check badge" icon.
 *
 * Design: document with folded corner + line items + dollar sign,
 * overlaid by a circular checkmark badge in the upper-left.
 *
 * Used by both Dropship Invoice Validator and E-Reconciliation entries
 * to signal "validated invoice / money document".
 *
 * Colors follow currentColor. Two masks cut the white content (lines,
 * dollar sign, fold crease, check tick) out of the filled silhouette
 * so the icon remains single-color.
 */
const InvoiceCheckIcon: React.FC<IconProps> = ({
  size,
  className,
  ...rest
}) => {
  const uid = useId();
  const docMaskId = `${uid}-doc`;
  const badgeMaskId = `${uid}-badge`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size ?? "1em"}
      height={size ?? "1em"}
      fill="currentColor"
      stroke="none"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <defs>
        <mask id={docMaskId}>
          {/* white = keep filled, black = cut out */}
          <rect width="24" height="24" fill="white" />

          {/* Fold crease line (L-shape at folded corner) */}
          <path
            d="M17 4 V8 H21"
            stroke="black"
            strokeWidth="0.8"
            fill="none"
            strokeLinejoin="round"
          />

          {/* Pill-shaped amount lines */}
          <rect x="12" y="13" width="3.6" height="1.4" rx="0.7" fill="black" />
          <rect x="12" y="15.5" width="5" height="1.4" rx="0.7" fill="black" />
          <rect x="12" y="18" width="3" height="1.4" rx="0.7" fill="black" />

          {/* Dollar sign — vertical bar + S-curve */}
          <path
            d="M18 12 V18 M19.4 13.3 Q19.4 13 18.7 13 H17.4 Q16.3 13 16.3 14 Q16.3 15 17.4 15 H18.6 Q19.7 15 19.7 16 Q19.7 17 18.6 17 H17.3 Q16.6 17 16.6 16.6"
            stroke="black"
            strokeWidth="0.95"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>

        <mask id={badgeMaskId}>
          <rect width="24" height="24" fill="white" />
          {/* Checkmark tick — cut out of badge */}
          <path
            d="M5.6 7.3 L6.9 8.7 L9.2 6"
            stroke="black"
            strokeWidth="1.3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
      </defs>

      {/*
        Document silhouette.
        The left edge uses an arc (A 4 4 …) to carve a "bite" so the
        circular badge sits in a clean gap instead of overlapping the
        document fill.
      */}
      <path
        mask={`url(#${docMaskId})`}
        d="M11 4 H17 L21 8 V20 q0 1 -1 1 H11 q-1 0 -1 -1 V11 A4 4 0 0 1 10 5 Q10 4 11 4 Z"
      />

      {/* Check badge — sits in the arc bite on the document's left edge */}
      <circle cx="7.5" cy="7" r="3" mask={`url(#${badgeMaskId})`} />
    </svg>
  );
};

export default InvoiceCheckIcon;
