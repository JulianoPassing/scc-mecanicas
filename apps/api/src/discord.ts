type WorkshopLike = { name: string; primaryColor?: string | null };

function colorOf(ws: WorkshopLike) {
  return parseInt((ws.primaryColor || "#dc2626").replace("#", ""), 16) || 0xdc2626;
}

function stamp(ws?: WorkshopLike) {
  const when = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return ws ? `${ws.name} • ${when}` : when;
}

export function sendWebhook(
  url: string | null | undefined,
  embed: {
    title: string;
    description?: string;
    fields?: { name: string; value: string; inline?: boolean }[];
    color?: number;
    image?: { url: string };
  },
  ws?: WorkshopLike,
) {
  if (!url || !url.startsWith("https://")) return;
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: ws ? `Relatório · ${ws.name}` : "SCC Mecânicas",
      allowed_mentions: { parse: [] },
      embeds: [
        {
          color: embed.color ?? (ws ? colorOf(ws) : 0xdc2626),
          footer: { text: stamp(ws) },
          ...embed,
        },
      ],
    }),
  }).catch(() => {});
}

export function moneyBr(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
