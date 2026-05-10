// src/assets/icons/AccessRequestIcon.tsx
import Icon, { type IconProps } from "./Icon";

/** Shield with plus — request new access / permission */
const AccessRequestIcon: React.FC<IconProps> = (props) => (
  <Icon {...props}>
    <path d="M12 3 4 6v6c0 4.5 3.2 8.4 8 9 4.8-.6 8-4.5 8-9V6l-8-3Z" />
    <path d="M12 9v6" />
    <path d="M9 12h6" />
  </Icon>
);

export default AccessRequestIcon;
