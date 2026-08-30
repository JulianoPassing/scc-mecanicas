export const BRANDS: Record<string, { logo: string; color: string; tag: string }> = {
  reds: { logo: "/logos/reds.png", color: "#dc2626", tag: "Performance" },
  tuner: { logo: "/logos/tuner.png", color: "#2563eb", tag: "Custom" },
  power: { logo: "/logos/power.png", color: "#ca8a04", tag: "Potência" },
  motoclube: { logo: "/logos/motoclube.png", color: "#16a34a", tag: "Motos" },
};

export function brandOf(slug?: string | null) {
  if (!slug) return { logo: "/favicon.png", color: "#dc2626", tag: "SCC" };
  return BRANDS[slug] ?? { logo: `/logos/${slug}.png`, color: "#dc2626", tag: "Oficina" };
}

export function money(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

export function when(iso?: string | Date | null) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function daysLeft(endsAt?: string | null) {
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86400000));
}