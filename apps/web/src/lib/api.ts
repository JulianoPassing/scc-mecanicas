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

export type ServiceOrder = {
  id: string;
  workshopId: string;
  mechanicName: string;
  clientName: string;
  plate: string;
  notes: string | null;
  total: number;
  createdAt: string;
};

export type OrderItem = { kind: "install" | "remove" | "product"; name: string; quantity: number; unitPrice: number };

export type Employee = {
  id: string;
  name: string;
  discordId: string;
  roleLabel: string | null;
  status: string;
};

export type HierarchyRole = { id?: string; label: string; nicknamePrefix: string | null; discordRoleId: string | null };

export type Blacklist = {
  id: string;
  employeeName: string;
  discordId: string | null;
  reason: string;
  days: number;
  startsAt: string;
  endsAt: string;
};

export type Product = { id: string; name: string; price: number; stock: number };

export type PontoRow = {
  id: string;
  discordId: string;
  openedAt: string;
  closedAt: string | null;
};

export type FarmRow = {
  id: string;
  discordId: string;
  amount: number;
  status: string;
  createdAt: string;
};

export type Billing = {
  days: { day: string; total: number; count: number }[];
  mechanics: { name: string; total: number; count: number }[];
};

export type Summary = {
  workshop: Workshop & { guildId?: string | null };
  today: { total: number; count: number };
  month: { total: number; count: number };
  staff: number;
  blacklistActive: number;
};

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
