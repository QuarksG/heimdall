// src/assets/icons/RetailValidatorIcon.tsx
import Icon, { type IconProps } from "./Icon";

/** Shopping bag with a check — retail invoice validator */
const RetailValidatorIcon: React.FC<IconProps> = (props) => (
  <Icon {...props}>
    <path d="M5 7h14l-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7Z" />
    <path d="M9 7V5a3 3 0 0 1 6 0v2" />
    <path d="m9 14 2 2 4-4" />
  </Icon>
);

export default RetailValidatorIcon;
