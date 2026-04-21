import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === "loading") {
    return (
      <div className="auth-loading">
        <p>Loading…</p>
      </div>
    );
  }
  if (status === "anon") {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
