// src/assets/icons/index.ts
import type React from "react";
import type { FeatureKey } from "../../features/authentication/hooks/usePermissions";
import type { IconProps } from "./Icon";

import HomeIcon from "./HomeIcon";
import AccessRequestIcon from "./AccessRequestIcon";
import InvoiceParsingIcon from "./InvoiceParsingIcon";
import RetailValidatorIcon from "./RetailValidatorIcon";
import InvoiceConvertIcon from "./InvoiceConvertIcon";
import DropshipValidatorIcon from "./DropshipValidatorIcon";
import ReconciliationIcon from "./ReconciliationIcon";
import InvoiceCheckIcon from "./InvoiceCheckIcon";
import XmlFileIcon from "./XmlFileIcon";
import CRTRExtractionIcon from "./CRTRExtractionIcon";
import SettingsIcon from "./SettingsIcon";
import HelpIcon from "./HelpIcon";
import LogoutIcon from "./LogoutIcon";
import LockIcon from "./LockIcon";
import ChevronLeftIcon from "./ChevronLeftIcon";
import ChevronRightIcon from "./ChevronRightIcon";

export { default as Icon } from "./Icon";
export type { IconProps } from "./Icon";

export {
  HomeIcon,
  AccessRequestIcon,
  InvoiceParsingIcon,
  RetailValidatorIcon,
  InvoiceConvertIcon,
  DropshipValidatorIcon,
  ReconciliationIcon,
  InvoiceCheckIcon,
  XmlFileIcon,
  CRTRExtractionIcon,
  SettingsIcon,
  HelpIcon,
  LogoutIcon,
  LockIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
};

export type IconComponent = React.FC<IconProps>;

/**
 * Maps a sidebar FeatureKey to the icon component that represents it.
 * Keep this in sync with FeatureKey in usePermissions.
 */
export const SidebarIcons: Record<FeatureKey, IconComponent> = {
  Home: HomeIcon,
  AccessRequest: AccessRequestIcon,
  InvoiceParsing: InvoiceParsingIcon,
  InvoiceControl: RetailValidatorIcon,
  InvoiceVerify: InvoiceConvertIcon,
  InvoiceValidateDF: DropshipValidatorIcon,
  Recon: ReconciliationIcon,
  CRTRExtraction: CRTRExtractionIcon,
  Settings: SettingsIcon,
  Help: HelpIcon,
  Logout: LogoutIcon,
};
