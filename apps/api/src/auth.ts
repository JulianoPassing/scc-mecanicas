import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env.js";

const secret = new TextEncoder().encode(env.jwtSecret);
const COOKIE = "scc_session";

export function cookieName() {
  return COOKIE;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function signToken(payload: { sub: string }) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(secret);
}

export async function verifyToken(token: string) {
  const { payload } = await jwtVerify(token, secret);
  return payload.sub as string;
}

export function cookieHeader(token: string) {
  const parts = [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    env.cookieSecure ? "SameSite=None" : "SameSite=Lax",
    "Max-Age=1209600",
  ];
  if (env.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookieHeader() {
  const parts = [
    `${COOKIE}=`,
    "Path=/",
    "HttpOnly",
    env.cookieSecure ? "SameSite=None" : "SameSite=Lax",
    "Max-Age=0",
  ];
  if (env.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}
