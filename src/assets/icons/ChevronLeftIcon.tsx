// src/assets/icons/ChevronLeftIcon.tsx
import Icon, { type IconProps } from "./Icon";

/** Chevron left — collapse sidebar */
const ChevronLeftIcon: React.FC<IconProps> = (props) => (
  <Icon {...props}>
    <path d="m15 6-6 6 6 6" />
  </Icon>
);

export default ChevronLeftIcon;
