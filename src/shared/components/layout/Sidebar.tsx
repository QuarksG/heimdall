// src/shared/components/layout/Sidebar.tsx
import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  usePermissions,
  type FeatureKey,
} from "../../../features/authentication/hooks/usePermissions";
import { useAuth } from "../../../features/authentication/context/AuthContext";
import userImage from "../../../assets/images/user.jpg";
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
  icon: string;
  label: string;
}

const Sidebar: React.FC = () => {
  const [isFolded, setIsFolded] = useState(false);
  const { isUnlocked, isAdmin } = usePermissions();
  const { user, signOut } = useAuth();
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

  const SidebarItem: React.FC<SidebarItemProps> = ({ id, icon, label }) => (
    <li className={isActive(id) ? "active" : ""}>
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          handleMenuClick(id);
        }}
      >
        <div className="link-content">
          <i className={`icon ph-bold ${icon}`}></i>
          <span className="text">{label}</span>
        </div>

        {!isUnlocked(id) && (
          <i
            className="ph-bold ph-lock-key lock-icon"
            title="Requires Approval"
          ></i>
        )}
      </a>
    </li>
  );

  return (
    <div className={`sidebar ${isFolded ? "folded" : ""}`}>
      <div className="menu-btn" onClick={toggleSidebar}>
        <i
          className={`ph-bold ${isFolded ? "ph-caret-right" : "ph-caret-left"}`}
        ></i>
      </div>

      {/* ── USER SECTION ── */}
      <div className="user-section">
        <div className="user-img">
          <img src={userImage} alt="User" />
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
            {/* Home — always accessible */}
            <li className={isActive("Home") ? "active" : ""}>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  handleMenuClick("Home");
                }}
              >
                <div className="link-content">
                  <i className="icon ph-bold ph-house-simple"></i>
                  <span className="text">Home</span>
                </div>
              </a>
            </li>

            {/* Access Request — always accessible */}
            <li className={isActive("AccessRequest") ? "active" : ""}>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  handleMenuClick("AccessRequest");
                }}
              >
                <div className="link-content">
                  <i className="icon ph-bold ph-shield-plus"></i>
                  <span className="text">Access Request</span>
                </div>
              </a>
            </li>

            {/* Feature items — lock icon shown if no access */}
            <SidebarItem id="InvoiceParsing" icon="ph-file-text" label="Invoice Parsing" />
            <SidebarItem id="InvoiceControl" icon="ph-calendar-blank" label="Retail Invoice Validator" />
            <SidebarItem id="InvoiceVerify" icon="ph-chart-bar" label="Invoice Convert" />
            <SidebarItem id="InvoiceValidateDF" icon="ph-chart-bar" label="DF Invoice Validator" />
            <SidebarItem id="Recon" icon="ph-chart-bar" label="E-Reconciliation" />
            <SidebarItem id="CRTRExtraction" icon="ph-file-export" label="CRTR Extraction" />
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
            <SidebarItem id="Settings" icon="ph-gear" label="Settings" />
          </ul>
        </div>

        <div className="sidebar-separator"></div>

        {/* ACCOUNT */}
        <div className="nav-group">
          <p className="group-title">ACCOUNT</p>
          <ul>
            <li className={isActive("Help") ? "active" : ""}>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  handleMenuClick("Help");
                }}
              >
                <div className="link-content">
                  <i className="icon ph-bold ph-info"></i>
                  <span className="text">Help</span>
                </div>
              </a>
            </li>

            {/* Logout */}
            <li>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  handleMenuClick("Logout");
                }}
              >
                <div className="link-content">
                  <i className="icon ph-bold ph-sign-out"></i>
                  <span className="text">Sign Out</span>
                </div>
              </a>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;