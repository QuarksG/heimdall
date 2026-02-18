// src/features/authentication/components/LogoutButton.tsx
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "../styles/auth.css";

export default function LogoutButton() {
  const nav = useNavigate();
  const { signOut } = useAuth();

  return (
    <button
      type="button"
      className="auth-logout-btn"
      onClick={async () => {
        await signOut();
        nav("/auth/terms", { replace: true });
      }}
    >
      Sign Out
    </button>
  );
}