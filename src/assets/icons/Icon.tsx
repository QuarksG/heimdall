// src/assets/icons/Icon.tsx
import React from "react";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  /** Pixel or CSS size. Defaults to "1em" so it scales with parent font-size. */
  size?: number | string;
}

type IconBaseProps = IconProps & { children: React.ReactNode };

/**
 * Shared wrapper for every custom sidebar icon.
 * - 24x24 viewBox
 * - stroke-based (inherits color via currentColor)
 * - sizes with parent font-size by default (1em)
 *
 * Any SVG prop can be overridden from the caller.
 */
export const Icon: React.FC<IconBaseProps> = ({
  size,
  className,
  strokeWidth = 2,
  children,
  ...rest
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size ?? "1em"}
    height={size ?? "1em"}
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {children}
  </svg>
);

export default Icon;
