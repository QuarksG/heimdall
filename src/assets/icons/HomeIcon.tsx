// src/assets/icons/HomeIcon.tsx
import Icon, { type IconProps } from "./Icon";

/** House with doorway — Home / Dashboard */
const HomeIcon: React.FC<IconProps> = (props) => (
  <Icon {...props}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
  </Icon>
);

export default HomeIcon;
