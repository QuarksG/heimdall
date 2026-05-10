// src/assets/icons/LogoutIcon.tsx
import Icon, { type IconProps } from "./Icon";

/** Door with right-arrow — Sign out */
const LogoutIcon: React.FC<IconProps> = (props) => (
  <Icon {...props}>
    <path d="M10 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H10" />
  </Icon>
);

export default LogoutIcon;
