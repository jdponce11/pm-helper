/** HTTP-only cookie storing the JWT */
export const AUTH_COOKIE_NAME = "pm_auth";

export function getJwtSecret(): string {
  const s = (process.env.JWT_SECRET ?? process.env.SECRET_KEY)?.trim();
  if (!s) {
    throw new Error("SECRET_KEY or JWT_SECRET is required for authentication");
  }
  return s;
}
