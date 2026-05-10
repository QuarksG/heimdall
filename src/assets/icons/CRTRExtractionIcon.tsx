// src/assets/icons/CRTRExtractionIcon.tsx
import Icon, { type IconProps } from "./Icon";

/** Document with down-arrow — extracting / exporting CRTR data */
const CRTRExtractionIcon: React.FC<IconProps> = (props) => (
  <Icon {...props}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5" />
    <path d="M12 11v6" />
    <path d="m9 15 3 3 3-3" />
  </Icon>
);

export default CRTRExtractionIcon;
