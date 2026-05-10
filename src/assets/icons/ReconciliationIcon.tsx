// src/assets/icons/ReconciliationIcon.tsx
import { useId } from "react";
import type { IconProps } from "./Icon";

/**
 * "Excel folder" glyph — a filled folder with the letter E cut out of
 * its face, plus an outlined second folder peeking from behind.
 *
 * Single color via currentColor. The front folder is filled; the back
 * folder is a thin stroked path so the two read as stacked folders.
 */
const ReconciliationIcon: React.FC<IconProps> = ({
  size,
  className,
  ...rest
}) => {
  const uid = useId();
  const folderMaskId = `${uid}-folder`;

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
        <mask id={folderMaskId}>
          {/* white = keep filled, black = cut */}
          <rect width="24" height="24" fill="white" />

          {/* Letter "E" cut out of the folder face */}
          <path
            d="
              M8.2 10.5
              H13.2
              V12.3
              H10.3
              V13.7
              H12.6
              V15.3
              H10.3
              V17
              H13.3
              V18.8
              H8.2
              Z
            "
            fill="black"
          />
        </mask>
      </defs>

      {/*
        Back folder — outlined only, peeks from upper-right with a small
        tail that curves down on the right side.
      */}
      <path
        d="M6 6 H10 L11.5 8 H19 V17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 17 Q19 18.5 17.6 18.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Front folder — filled silhouette with E cut out */}
      <path
        mask={`url(#${folderMaskId})`}
        d="
          M4 9
          Q4 7.5 5.5 7.5
          H8
          L9.5 9.5
          H16
          Q17.5 9.5 17.5 11
          V19
          Q17.5 20.5 16 20.5
          H5.5
          Q4 20.5 4 19
          Z
        "
      />
    </svg>
  );
};

export default ReconciliationIcon;
