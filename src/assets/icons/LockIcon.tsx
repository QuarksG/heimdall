// src/assets/icons/LockIcon.tsx
import Icon, { type IconProps } from "./Icon";

/** Padlock — feature locked, requires approval */
const LockIcon: React.FC<IconProps> = (props) => (
  <Icon {...props}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    <circle cx="12" cy="16" r="1" fill="currentColor" stroke="none" />
  </Icon>
);

export default LockIcon;
