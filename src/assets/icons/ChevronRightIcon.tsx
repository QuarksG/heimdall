// src/assets/icons/ChevronRightIcon.tsx
import Icon, { type IconProps } from "./Icon";

/** Chevron right — expand sidebar */
const ChevronRightIcon: React.FC<IconProps> = (props) => (
  <Icon {...props}>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);

export default ChevronRightIcon;
