// src/assets/icons/XmlFileIcon.tsx
import { useId } from "react";
import type { IconProps } from "./Icon";

/**
 * XML file icon — black header tab labeled "XML" with code brackets </>
 * in the body. Single-color, filled style; color via currentColor.
 *
 * Used by any sidebar entry that conceptually operates on XML (e-fatura)
 * documents. Currently shared by Invoice Parsing and E-Reconciliation.
 */
const XmlFileIcon: React.FC<IconProps> = ({ size, className, ...rest }) => {
  const uid = useId();
  const headerMaskId = `${uid}-header`;

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
        <mask id={headerMaskId}>
          {/* white = keep filled, black = cut */}
          <rect width="24" height="24" fill="white" />

          {/* Folded-corner triangle — cut out of header */}
          <path d="M4 3 L8 3 L4 7 Z" fill="black" />

          {/* "XML" text, positioned on the header */}
          <text
            x="16"
            y="8.4"
            textAnchor="middle"
            fontFamily="Arial, Helvetica, sans-serif"
            fontWeight="900"
            fontSize="4.6"
            fill="black"
            letterSpacing="0.1"
          >
            XML
          </text>
        </mask>
      </defs>

      {/* Header block — rounded top corners only */}
      <path
        mask={`url(#${headerMaskId})`}
        d="M4 5 Q4 3 6 3 H18 Q20 3 20 5 V11 H4 Z"
      />

      {/* Body card — outlined rectangle with rounded bottom corners */}
      <path
        d="M4 11 H20 V19 Q20 21 18 21 H6 Q4 21 4 19 Z
           M5.4 12.4 V19 Q5.4 19.6 6 19.6 H18 Q18.6 19.6 18.6 19 V12.4 Z"
        fillRule="evenodd"
      />

      {/* Code brackets: < / > */}
      <path
        d="M10.6 14.3 L8.9 16 L10.6 17.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13 13.6 L11 18.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M13.4 14.3 L15.1 16 L13.4 17.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default XmlFileIcon;
