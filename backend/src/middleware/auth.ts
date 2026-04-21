import type { CookieOptions } from "express";
import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { AUTH_COOKIE_NAME, getJwtSecret } from "../authConfig.js";

function readBearer(req: { headers: { authorization?: string } }): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export function readAuthToken(req: {
  cookies?: Record<string, string>;
  headers: { authorization?: string; cookie?: string };
}): string | null {
  const fromCookie = req.cookies?.[AUTH_COOKIE_NAME];
  if (typeof fromCookie === "string" && fromCookie) return fromCookie;
  const bearer = readBearer(req);
  if (bearer) return bearer;
  return null;
}

/** Returns user id + email if the JWT is valid; otherwise null. */
export function verifyAuthToken(token: string): { id: number; email: string } | null {
  try {
    const raw = jwt.verify(token, getJwtSecret());
    if (typeof raw === "string" || typeof raw !== "object" || raw === null) {
      return null;
    }
    const decoded = raw as jwt.JwtPayload;
    const id = Number(decoded.sub);
    if (!Number.isInteger(id) || id < 1) return null;
    const email = (decoded as jwt.JwtPayload & { email?: unknown }).email;
    if (typeof email !== "string") return null;
    return { id, email };
  } catch {
    return null;
  }
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const token = readAuthToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const user = verifyAuthToken(token);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }
  req.user = user;
  next();
};

function cookieSecureFlag(): boolean {
  const v = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  return false;
}

export function authCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecureFlag(),
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export function clearAuthCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecureFlag(),
    path: "/",
  };
}
