// src/assets/icons/HelpIcon.tsx
import Icon, { type IconProps } from "./Icon";

/** Circle with question mark — Help */
const HelpIcon: React.FC<IconProps> = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.3 9a2.7 2.7 0 0 1 5.2 1c0 2-2.5 2.2-2.5 4" />
    <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
  </Icon>
);

export default HelpIcon;
