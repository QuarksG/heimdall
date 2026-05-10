// src/assets/icons/InvoiceConvertIcon.tsx
import Icon, { type IconProps } from "./Icon";

/** Document with bidirectional arrows — invoice format conversion */
const InvoiceConvertIcon: React.FC<IconProps> = (props) => (
  <Icon {...props}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5" />
    <path d="m9 13 2-2 2 2" />
    <path d="M11 11v6" />
    <path d="m15 15-2 2-2-2" />
  </Icon>
);

export default InvoiceConvertIcon;
