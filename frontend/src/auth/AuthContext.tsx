import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthUser } from "../types";
import { fetchMe, login as apiLogin, logout as apiLogout, register as apiRegister } from "../api";

type AuthStatus = "loading" | "anon" | "authed";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);

  const refresh = useCallback(async () => {
    try {
      const u = await fetchMe();
      if (u) {
        setUser(u);
        setStatus("authed");
      } else {
        setUser(null);
        setStatus("anon");
      }
    } catch {
      setUser(null);
      setStatus("anon");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const u = await apiLogin(email, password);
    setUser(u);
    setStatus("authed");
  }, []);

  const register = useCallback(async (email: string, password: string, fullName: string) => {
    const u = await apiRegister(email, password, fullName);
    setUser(u);
    setStatus("authed");
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setUser(null);
      setStatus("anon");
    }
  }, []);

  const value = useMemo(
    () => ({ status, user, refresh, login, register, logout }),
    [status, user, refresh, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
