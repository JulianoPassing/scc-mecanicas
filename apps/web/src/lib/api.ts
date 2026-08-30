const BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:8787").replace(/\/$/, "");
const TOKEN_KEY = "scc_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Erro ${res.status}`);
  return data as T;
}

export type Workshop = { id: string; slug: string; name: string; primaryColor: string };

export type Me = {
  id: string;
  username: string;
  discordId: string;
  displayName: string | null;
  approved: boolean;
  requestedWorkshopId: string | null;
  isOwner: boolean;
  isAdmin: boolean;
  isDonoMec: boolean;
  donoWorkshops: string[];
  roles: { role: string; workshopId: string | null }[];
  employee: { id: string; name: string; workshopId: string; workshopSlug: string; workshopName: string } | null;
  employees: { id: string; name: string; workshopId: string; workshopSlug: string; workshopName: string }[];
  accessibleWorkshopIds: string[];
};

export type AdminUser = {
  id: string;
  username: string;
  discordId: string;
  displayName: string | null;
  approved: boolean;
  requestedWorkshopId: string | null;
  createdAt: string;
  roles: { role: string; workshopId: string | null }[];
};

export type WorkshopAdmin = Workshop & {
  guildId: string | null;
  pontoChannelId: string | null;
  farmChannelId: string | null;
  logChannelId: string | null;
  pontoAutoCloseHours: number;
  orderWebhookUrl: string | null;
  hierarchyWebhookUrl: string | null;
  staffEventsWebhookUrl: string | null;
  blacklistWebhookUrl: string | null;
  whitelistWebhookUrl: string | null;
  pontoWebhookUrl: string | null;
  farmWebhookUrl: string | null;
};
