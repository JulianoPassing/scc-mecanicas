import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { toast } from "sonner";
import { LogOut, Save } from "lucide-react";
import { useAuth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type AdminUser, type Workshop, type WorkshopAdmin } from "@/lib/api";
import { brandOf } from "@/lib/brands";

export function AdminPage() {
  const { me, loading, logout } = useAuth();
  const donoOnly = !!me && me.isDonoMec && !me.isAdmin;
  const [tab, setTab] = useState<"users" | "workshops">("users");

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        <img src="/favicon.png" alt="" className="w-10 h-10 mr-3 rounded-xl logo-float" />
        Carregando…
      </div>
    );
  }
  if (!me) return <Navigate to="/" replace />;
  if (!me.approved && !me.isOwner) return <Navigate to="/pendente" replace />;
  if (!me.isAdmin && !me.isDonoMec) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen">
      <header className="border-b px-4 py-3 flex items-center justify-between bg-card/40 backdrop-blur-xl sticky top-0 z-20">
        <div className="flex items-center gap-2 font-semibold">
          <img src="/favicon.png" alt="" className="w-8 h-8 rounded-lg" />
          Painel admin
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/">Início</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            <LogOut className="w-4 h-4" /> Sair
          </Button>
        </div>
      </header>
      <main className="max-w-5xl mx-auto p-4 md:p-6 space-y-4 anim-up">
        <ShopLinks />
        {donoOnly && (
          <p className="text-sm text-muted-foreground">
            Você vê só os cadastros da sua mecânica. Liberar coloca a pessoa na equipe.
          </p>
        )}
        <div className="flex gap-2">
          <Button variant={tab === "users" ? "default" : "outline"} size="sm" onClick={() => setTab("users")}>
            Cadastros
          </Button>
          {me.isAdmin && (
            <Button variant={tab === "workshops" ? "default" : "outline"} size="sm" onClick={() => setTab("workshops")}>
              Mecânicas / Discord
            </Button>
          )}
        </div>
        {tab === "users" ? <UsersTab donoOnly={donoOnly} donoWorkshops={me.donoWorkshops} /> : <WorkshopsTab />}
      </main>
    </div>
  );
}

function ShopLinks() {
  const [shops, setShops] = useState<Workshop[]>([]);
  useEffect(() => {
    api<Workshop[]>("/admin/workshops")
      .then(setShops)
      .catch(() => api<Workshop[]>("/workshops").then(setShops).catch(() => {}));
  }, []);
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {shops.map((w) => {
        const b = brandOf(w.slug);
        return (
          <Link key={w.id} to={`/oficina/${w.slug}`}>
            <Card
              className="p-4 glass hover-lift text-center"
              style={{ "--shop": w.primaryColor || b.color } as React.CSSProperties}
            >
              <img src={b.logo} alt={w.name} className="h-16 mx-auto object-contain" />
              <div className="font-semibold mt-2">{w.name}</div>
              <div className="text-[11px] text-muted-foreground">Abrir painel</div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

function UsersTab({ donoOnly, donoWorkshops }: { donoOnly: boolean; donoWorkshops: string[] }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [wsPick, setWsPick] = useState<Record<string, string>>({});

  async function load() {
    const [u, w] = await Promise.all([
      api<AdminUser[]>("/admin/users"),
      api<Workshop[]>(donoOnly ? "/admin/workshops" : "/workshops"),
    ]);
    setUsers(u);
    setWorkshops(w);
  }

  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, []);

  async function saveAccess(u: AdminUser) {
    const role = roles[u.id] || u.roles.find((r) => r.role !== "owner")?.role || "mechanic";
    const workshopId = wsPick[u.id] || u.requestedWorkshopId;
    try {
      await api(`/admin/users/${u.id}/access`, {
        method: "POST",
        body: JSON.stringify({ role, workshopId }),
      });
      toast.success("Cargo e mecânica atualizados");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    }
  }

  async function approve(u: AdminUser, approved: boolean) {
    const role = roles[u.id] || "mechanic";
    const workshopId = wsPick[u.id] || u.requestedWorkshopId;
    try {
      await api(`/admin/users/${u.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ approved, role: approved ? role : undefined, workshopId }),
      });
      toast.success(approved ? "Acesso liberado" : "Acesso revogado");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Libere o cadastro escolhendo cargo e mecânica. Em quem já está liberado, mude os selects e clique em{" "}
        <strong>Salvar cargo</strong>.
      </p>
      {users.map((u) => (
        <Card key={u.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
          <div className="text-sm">
            <div className="font-medium">
              {u.username}{" "}
              <span className="text-muted-foreground font-normal">· Discord {u.discordId}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {u.approved ? "Liberado" : "Pendente"} · cargos:{" "}
              {u.roles.map((r) => r.role).join(", ") || "—"}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              value={roles[u.id] ?? u.roles.find((r) => r.role !== "owner")?.role ?? "mechanic"}
              onChange={(e) => setRoles((s) => ({ ...s, [u.id]: e.target.value }))}
            >
              <option value="mechanic">Mecânico</option>
              <option value="manager_mec">Gerente</option>
              {!donoOnly && (
                <>
                  <option value="dono_mec">Dono da mecânica</option>
                  <option value="admin">Admin (todas)</option>
                </>
              )}
            </select>
            <select
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              value={wsPick[u.id] ?? u.requestedWorkshopId ?? donoWorkshops[0] ?? ""}
              onChange={(e) => setWsPick((s) => ({ ...s, [u.id]: e.target.value }))}
              disabled={donoOnly && workshops.length <= 1}
            >
              <option value="">Mecânica</option>
              {workshops.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            {u.approved ? (
              <>
                <Button size="sm" onClick={() => void saveAccess(u)}>
                  Salvar cargo
                </Button>
                <Button size="sm" variant="outline" onClick={() => void approve(u, false)}>
                  Revogar
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => void approve(u, true)}>
                Liberar
              </Button>
            )}
          </div>
        </Card>
      ))}
      {users.length === 0 && <p className="text-sm text-muted-foreground">Nenhum cadastro ainda.</p>}
    </div>
  );
}

const CHANNEL_FIELDS: { key: keyof WorkshopAdmin; label: string; hint: string }[] = [
  { key: "guildId", label: "Guild ID (servidor Discord)", hint: "Servidor onde o bot 1543653928996970650 atua nesta mecânica" },
  { key: "pontoChannelId", label: "Canal do ponto (ID)", hint: "Canal da embed /ponto setup" },
  { key: "farmChannelId", label: "Canal do farm (ID)", hint: "Canal da embed /farm-painel" },
  { key: "logChannelId", label: "Canal de logs (ID)", hint: "Referência no site; o bot também guarda via /set_log_channel" },
];

const WEBHOOK_FIELDS: { key: keyof WorkshopAdmin; label: string }[] = [
  { key: "orderWebhookUrl", label: "Webhook OS" },
  { key: "hierarchyWebhookUrl", label: "Webhook hierarquia" },
  { key: "staffEventsWebhookUrl", label: "Webhook staff" },
  { key: "blacklistWebhookUrl", label: "Webhook blacklist" },
  { key: "whitelistWebhookUrl", label: "Webhook whitelist" },
  { key: "pontoWebhookUrl", label: "Webhook ponto" },
  { key: "farmWebhookUrl", label: "Webhook farm" },
];

function WorkshopsTab() {
  const [rows, setRows] = useState<WorkshopAdmin[]>([]);

  useEffect(() => {
    api<WorkshopAdmin[]>("/admin/workshops")
      .then(setRows)
      .catch((e) => toast.error(e.message));
  }, []);

  async function save(row: WorkshopAdmin) {
    try {
      const updated = await api<WorkshopAdmin>(`/admin/workshops/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          guildId: row.guildId,
          pontoChannelId: row.pontoChannelId,
          farmChannelId: row.farmChannelId,
          logChannelId: row.logChannelId,
          pontoAutoCloseHours: row.pontoAutoCloseHours,
          orderWebhookUrl: row.orderWebhookUrl,
          hierarchyWebhookUrl: row.hierarchyWebhookUrl,
          staffEventsWebhookUrl: row.staffEventsWebhookUrl,
          blacklistWebhookUrl: row.blacklistWebhookUrl,
          whitelistWebhookUrl: row.whitelistWebhookUrl,
          pontoWebhookUrl: row.pontoWebhookUrl,
          farmWebhookUrl: row.farmWebhookUrl,
          farmWeeklyGoal: row.farmWeeklyGoal,
        }),
      });
      setRows((list) => list.map((r) => (r.id === updated.id ? updated : r)));
      toast.success(`${row.name} salvo`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar");
    }
  }

  function patch(id: string, key: keyof WorkshopAdmin, value: string | number) {
    setRows((list) =>
      list.map((r) => (r.id === id ? { ...r, [key]: value === "" ? null : value } : r)),
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Guild e canais de cada Discord. Detalhe do que o bot faz em cada canal: veja DISCORD.md no repo.
      </p>
      {rows.map((w) => (
        <Card key={w.id} className="p-5 space-y-3 glass shop-ring" style={{ "--shop": w.primaryColor } as React.CSSProperties}>
          <div className="flex items-center gap-3">
            <img src={brandOf(w.slug).logo} alt="" className="h-12 w-12 object-contain" />
            <h3 className="font-semibold text-lg">{w.name}</h3>
          </div>
          <div className="grid gap-3">
            {CHANNEL_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label>{f.label}</Label>
                <Input
                  className="font-mono text-xs"
                  value={(w[f.key] as string | null) ?? ""}
                  onChange={(e) => patch(w.id, f.key, e.target.value)}
                  placeholder="ID numérico do Discord"
                />
                <p className="text-xs text-muted-foreground">{f.hint}</p>
              </div>
            ))}
            {WEBHOOK_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label>{f.label}</Label>
                <Input
                  className="font-mono text-xs"
                  type="password"
                  value={(w[f.key] as string | null) ?? ""}
                  onChange={(e) => patch(w.id, f.key, e.target.value)}
                  placeholder="https://discord.com/api/webhooks/…"
                />
              </div>
            ))}
            <div className="space-y-1">
              <Label>Meta semanal de farm</Label>
              <Input
                type="number"
                min={0}
                value={w.farmWeeklyGoal ?? 300}
                onChange={(e) => patch(w.id, "farmWeeklyGoal", Number(e.target.value))}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => void save(w)}>
              <Save className="w-4 h-4" /> Salvar
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
