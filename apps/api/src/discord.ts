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

export async function postFarmImageToDiscord(
  webhookUrl: string | null | undefined,
  file: { bytes: Buffer; filename: string; contentType: string },
  embed: {
    title: string;
    description?: string;
    fields?: { name: string; value: string; inline?: boolean }[];
    color?: number;
  },
  ws?: WorkshopLike,
): Promise<string | null> {
  if (!webhookUrl || !webhookUrl.startsWith("https://")) return null;
  const filename = (file.filename || "print.png").replace(/[^\w.\-]/g, "_").slice(0, 80) || "print.png";
  const form = new FormData();
  form.append("files[0]", new Blob([new Uint8Array(file.bytes)], { type: file.contentType || "image/png" }), filename);
  form.append(
    "payload_json",
    JSON.stringify({
      username: ws ? `Farm · ${ws.name}` : "SCC Mecânicas",
      allowed_mentions: { parse: [] },
      embeds: [
        {
          color: embed.color ?? (ws ? colorOf(ws) : 0xdc2626),
          footer: { text: stamp(ws) },
          image: { url: `attachment://${filename}` },
          ...embed,
        },
      ],
    }),
  );
  try {
    const res = await fetch(`${webhookUrl.split("?")[0]}?wait=true`, { method: "POST", body: form });
    if (!res.ok) return null;
    const msg = (await res.json()) as { attachments?: { url?: string; proxy_url?: string }[] };
    const att = msg.attachments?.[0];
    return att?.url || att?.proxy_url || null;
  } catch {
    return null;
  }
}
