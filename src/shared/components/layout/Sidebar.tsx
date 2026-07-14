// src/shared/components/layout/Sidebar.tsx
import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  usePermissions,
  type FeatureKey,
} from "../../../features/authentication/hooks/usePermissions";
import { useAuth } from "../../../features/authentication/context/AuthContext";
import { useTheme } from "../../../shared/theme/ThemeContext";
import { Moon, Sun } from "lucide-react";
import userImage from "../../../assets/images/user.jpg";
import {
  SidebarIcons,
  LockIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  type IconComponent,
} from "../../../assets/icons";
import "../../../styles/components/sidebar.css";

const ROUTE_PATHS: Record<FeatureKey, string> = {
  Home: "/",
  AccessRequest: "/access-request",
  InvoiceParsing: "/invoice-parsing",
  InvoiceControl: "/invoice-validation/retail",
  InvoiceVerify: "/invoice-conversion",
  InvoiceValidateDF: "/invoice-validation/dropship",
  Recon: "/payment-reconciliation",
  CRTRExtraction: "/crtr-extraction",
  Settings: "/settings",
  Help: "/help",
  Logout: "/logout",
};

interface SidebarItemProps {
  id: FeatureKey;
  label: string;
  /** Override the default icon from SidebarIcons if needed. */
  icon?: IconComponent;
  /** When true, the lock indicator is hidden even if the user lacks access. */
  alwaysUnlocked?: boolean;
}

const Sidebar: React.FC = () => {
  const [isFolded, setIsFolded] = useState(false);
  const { isUnlocked, isAdmin } = usePermissions();
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const toggleSidebar = () => setIsFolded((s) => !s);

  const isActive = (id: FeatureKey) => {
    const path = ROUTE_PATHS[id];
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const handleMenuClick = (id: FeatureKey) => {
    if (id === "Logout") {
      void signOut().then(() => navigate("/auth/login", { replace: true }));
      return;
    }
    const path = ROUTE_PATHS[id];
    if (path) navigate(path);
  };

  const SidebarItem: React.FC<SidebarItemProps> = ({
    id,
    label,
    icon,
    alwaysUnlocked = false,
  }) => {
    const IconCmp = icon ?? SidebarIcons[id];
    const showLock = !alwaysUnlocked && !isUnlocked(id);

    return (
      <li className={isActive(id) ? "active" : ""}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            handleMenuClick(id);
          }}
        >
          <div className="link-content">
            <span className="icon">
              <IconCmp />
            </span>
            <span className="text">{label}</span>
          </div>

          {showLock && (
            <span className="lock-icon" title="Requires Approval">
              <LockIcon />
            </span>
          )}
        </a>
      </li>
    );
  };

  return (
    <div className={`sidebar ${isFolded ? "folded" : ""}`}>
      <div className="menu-btn" onClick={toggleSidebar}>
        {isFolded ? <ChevronRightIcon /> : <ChevronLeftIcon />}
      </div>

      {/* ── USER SECTION ── */}
      <div className="user-section">
        <div className="user-left">
          <div className="user-img">
            <img src={userImage} alt="User" />
          </div>

          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            <span className="theme-toggle-label">
              {theme === "dark" ? "Light" : "Dark"}
            </span>
          </button>
        </div>

        <div className="user-details">
          <p className="user-title">{isAdmin ? "ADMIN" : "STAFF"}</p>
          <p className="user-name">{user?.name ?? "User"}</p>
        </div>
      </div>

      <div className="sidebar-separator"></div>

      {/* ── SCROLLABLE NAVIGATION (E-FATURA features) ── */}
      <div className="sidebar-nav">
        <div className="nav-group">
          <p className="group-title">E-FATURA</p>
          <ul>
            {/* Always-accessible entries */}
            <SidebarItem id="Home" label="Home" alwaysUnlocked />
            <SidebarItem id="AccessRequest" label="Access Request" alwaysUnlocked />

            {/* Feature items — lock icon shown if no access */}
            <SidebarItem id="InvoiceParsing" label="Invoice Parsing" />
            <SidebarItem id="InvoiceControl" label="Retail Invoice Validator" />
            <SidebarItem id="InvoiceVerify" label="Invoice Convert" />
            <SidebarItem id="InvoiceValidateDF" label="DF Invoice Validator" />
            <SidebarItem id="Recon" label="E-Reconciliation" />
            <SidebarItem id="CRTRExtraction" label="CRTR Extraction" />
          </ul>
        </div>
      </div>

      {/* ── STICKY BOTTOM: ADMIN + ACCOUNT ── */}
      <div className="sidebar-bottom">
        <div className="sidebar-separator"></div>

        {/* SETTINGS — visible to everyone, lock icon for non-admin */}
        <div className="nav-group">
          <p className="group-title">ADMIN</p>
          <ul>
            <SidebarItem id="Settings" label="Settings" />
          </ul>
        </div>

        <div className="sidebar-separator"></div>

        {/* ACCOUNT */}
        <div className="nav-group">
          <p className="group-title">ACCOUNT</p>
          <ul>
            <SidebarItem id="Help" label="Help" alwaysUnlocked />
            <SidebarItem id="Logout" label="Sign Out" alwaysUnlocked />
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
