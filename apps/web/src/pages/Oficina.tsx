import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Ban,
  Clock3,
  LayoutDashboard,
  LogOut,
  Package,
  Plus,
  Receipt,
  Save,
  Sprout,
  Trash2,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  api,
  type Billing,
  type Blacklist,
  type Employee,
  type FarmRow,
  type HierarchyRole,
  type OrderItem,
  type PontoRow,
  type Product,
  type ServiceOrder,
  type Summary,
} from "@/lib/api";
import { brandOf, daysLeft, money, when } from "@/lib/brands";

function Splash() {
  return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
      <img src="/favicon.png" alt="" className="w-10 h-10 mr-3 rounded-xl logo-float" />
      Carregando painel…
    </div>
  );
}

type Tab = "resumo" | "os" | "faturamento" | "equipe" | "hierarquia" | "blacklist" | "estoque" | "ponto" | "farm";

const TABS: { id: Tab; label: string; icon: typeof Wrench }[] = [
  { id: "resumo", label: "Resumo", icon: LayoutDashboard },
  { id: "os", label: "Ordens de serviço", icon: Wrench },
  { id: "faturamento", label: "Faturamento", icon: Wallet },
  { id: "equipe", label: "Equipe", icon: Users },
  { id: "hierarquia", label: "Hierarquia", icon: Receipt },
  { id: "blacklist", label: "Blacklist", icon: Ban },
  { id: "estoque", label: "Estoque", icon: Package },
  { id: "ponto", label: "Ponto", icon: Clock3 },
  { id: "farm", label: "Farm", icon: Sprout },
];

export function OficinaPage() {
  const { slug } = useParams();
  const { me, loading, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("resumo");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [denied, setDenied] = useState(false);

  const brand = brandOf(slug);

  useEffect(() => {
    if (!slug || !me) return;
    api<Summary>(`/workshop/${slug}/summary`)
      .then((s) => {
        setDenied(false);
        setSummary(s);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("Sem acesso") || msg.includes("403")) setDenied(true);
        else toast.error(msg || "Falha ao carregar");
      });
  }, [slug, me, tab]);

  if (loading) return <Splash />;
  if (!me) return <Navigate to="/" replace />;
  if (!me.approved && !me.isOwner) return <Navigate to="/pendente" replace />;
  if (denied) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-6 max-w-md glass">Você não tem acesso a esta mecânica.</Card>
      </div>
    );
  }

  const name = summary?.workshop.name ?? me.employees.find((e) => e.workshopSlug === slug)?.workshopName ?? slug;
  const color = summary?.workshop.primaryColor || brand.color;
  const manage = me.isAdmin || me.isDonoMec || me.roles.some((r) => r.role === "manager_mec" || r.role === "dono_mec");

  return (
    <div className="min-h-screen flex" style={{ "--shop": color } as React.CSSProperties}>
      <aside className="hidden md:flex w-64 flex-col border-r bg-card/50 backdrop-blur-xl sticky top-0 h-screen">
        <div className="p-5 border-b flex items-center gap-3">
          <img src={brand.logo} alt={name} className="h-12 w-12 object-contain" />
          <div>
            <div className="font-bold leading-tight">{name}</div>
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Painel</div>
          </div>
        </div>
        <nav className="p-3 space-y-1 flex-1 overflow-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`nav-btn w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm ${
                tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t space-y-2">
          {(me.isAdmin || me.isDonoMec) && (
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link to="/admin">Admin</Link>
            </Button>
          )}
          <Button variant="outline" size="sm" className="w-full" onClick={() => void logout()}>
            <LogOut className="w-4 h-4" /> Sair
          </Button>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="md:hidden border-b px-4 py-3 flex items-center justify-between sticky top-0 bg-background/80 backdrop-blur-xl z-20">
          <div className="flex items-center gap-2 font-semibold">
            <img src={brand.logo} alt="" className="h-8 w-8 object-contain" /> {name}
          </div>
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            <LogOut className="w-4 h-4" />
          </Button>
        </header>
        <div className="md:hidden overflow-x-auto border-b px-2 py-2 flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs ${tab === t.id ? "bg-primary text-white" : "bg-secondary text-muted-foreground"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <main className="max-w-6xl mx-auto p-4 md:p-8 space-y-6 anim-up">
          {tab === "resumo" && <Resumo slug={slug!} summary={summary} />}
          {tab === "os" && <Ordens slug={slug!} />}
          {tab === "faturamento" && <Faturamento slug={slug!} />}
          {tab === "equipe" && <Equipe slug={slug!} manage={manage} />}
          {tab === "hierarquia" && <Hierarquia slug={slug!} manage={manage} />}
          {tab === "blacklist" && <BlacklistTab slug={slug!} manage={manage} />}
          {tab === "estoque" && <Estoque slug={slug!} manage={manage} />}
          {tab === "ponto" && <Ponto slug={slug!} />}
          {tab === "farm" && <Farm slug={slug!} manage={manage} />}
        </main>
      </div>
    </div>
  );
}

function Resumo({ slug, summary }: { slug: string; summary: Summary | null }) {
  const brand = brandOf(slug);
  const today = Number(summary?.today?.total ?? 0);
  const month = Number(summary?.month?.total ?? 0);
  return (
    <>
      <div className="flex items-center gap-4">
        <img src={brand.logo} alt="" className="h-16 w-16 object-contain logo-float" />
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold">{summary?.workshop.name ?? slug}</h1>
          <p className="text-sm text-muted-foreground">Operação do dia, equipe e pendências.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Hoje", value: money(today), sub: `${Number(summary?.today?.count ?? 0)} OS` },
          { label: "Mês", value: money(month), sub: `${Number(summary?.month?.count ?? 0)} OS` },
          { label: "Equipe ativa", value: String(summary?.staff ?? 0), sub: "funcionários" },
          { label: "Blacklist", value: String(summary?.blacklistActive ?? 0), sub: "ativas agora" },
        ].map((s) => (
          <Card key={s.label} className="p-5 glass shop-ring hover-lift">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</div>
            <div className="text-2xl font-extrabold stat-num mt-1">{s.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.sub}</div>
          </Card>
        ))}
      </div>
    </>
  );
}

function Ordens({ slug }: { slug: string }) {
  const [rows, setRows] = useState<ServiceOrder[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  async function load() {
    setRows(await api<ServiceOrder[]>(`/workshop/${slug}/orders${q ? `?q=${encodeURIComponent(q)}` : ""}`));
  }
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [slug]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Ordens de serviço</h2>
        <div className="flex gap-2">
          <Input placeholder="Placa ou dono" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
          <Button variant="outline" onClick={() => void load()}>
            Buscar
          </Button>
          <Button onClick={() => setOpen(true)}>
            <Plus className="w-4 h-4" /> Nova OS
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {rows.map((o) => (
          <Card key={o.id} className="p-4 glass flex flex-wrap items-center justify-between gap-3 hover-lift">
            <div>
              <div className="font-semibold">
                {o.plate} <span className="text-muted-foreground font-normal">· {o.clientName}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Mecânico {o.mechanicName} · {when(o.createdAt)}
              </div>
            </div>
            <div className="font-bold text-primary">{money(o.total)}</div>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma OS ainda.</p>}
      </div>
      {open && (
        <NovaOs
          slug={slug}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function NovaOs({ slug, onClose, onSaved }: { slug: string; onClose: () => void; onSaved: () => void }) {
  const [clientName, setClientName] = useState("");
  const [plate, setPlate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<OrderItem[]>([{ kind: "install", name: "", quantity: 1, unitPrice: 0 }]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<Product[]>(`/workshop/${slug}/products`).then(setProducts).catch(() => {});
  }, [slug]);

  const total = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api(`/workshop/${slug}/orders`, {
        method: "POST",
        body: JSON.stringify({ clientName, plate, notes, items }),
      });
      toast.success("OS lançada");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 anim-in" onClick={onClose}>
      <Card className="w-full max-w-2xl p-6 space-y-4 glass max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold">Nova ordem de serviço</h3>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Dono do veículo</Label>
              <Input value={clientName} onChange={(e) => setClientName(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>Placa</Label>
              <Input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} required />
            </div>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <select
                  className="col-span-3 h-9 rounded-md border border-input bg-transparent px-2 text-xs"
                  value={it.kind}
                  onChange={(e) => {
                    const kind = e.target.value as OrderItem["kind"];
                    setItems((list) => list.map((x, n) => (n === i ? { ...x, kind } : x)));
                  }}
                >
                  <option value="install">Instalar</option>
                  <option value="remove">Remover</option>
                  <option value="product">Peça</option>
                </select>
                {it.kind === "product" ? (
                  <select
                    className="col-span-5 h-9 rounded-md border border-input bg-transparent px-2 text-xs"
                    value={it.name}
                    onChange={(e) => {
                      const p = products.find((x) => x.name === e.target.value);
                      setItems((list) =>
                        list.map((x, n) => (n === i ? { ...x, name: e.target.value, unitPrice: p?.price ?? x.unitPrice } : x)),
                      );
                    }}
                  >
                    <option value="">Peça</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name} ({money(p.price)})
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    className="col-span-5"
                    placeholder="Serviço"
                    value={it.name}
                    onChange={(e) => setItems((list) => list.map((x, n) => (n === i ? { ...x, name: e.target.value } : x)))}
                  />
                )}
                <Input
                  className="col-span-2"
                  type="number"
                  min={1}
                  value={it.quantity}
                  onChange={(e) =>
                    setItems((list) => list.map((x, n) => (n === i ? { ...x, quantity: Number(e.target.value) } : x)))
                  }
                />
                <Input
                  className="col-span-2"
                  type="number"
                  min={0}
                  value={it.unitPrice}
                  onChange={(e) =>
                    setItems((list) => list.map((x, n) => (n === i ? { ...x, unitPrice: Number(e.target.value) } : x)))
                  }
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setItems((l) => [...l, { kind: "install", name: "", quantity: 1, unitPrice: 0 }])}
            >
              <Plus className="w-3 h-3" /> Item
            </Button>
          </div>
          <div className="space-y-1">
            <Label>Obs.</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex items-center justify-between pt-2">
            <div className="text-lg font-extrabold">{money(total)}</div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button disabled={loading}>{loading ? "Salvando…" : "Lançar OS"}</Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}

function Faturamento({ slug }: { slug: string }) {
  const [data, setData] = useState<Billing | null>(null);
  useEffect(() => {
    api<Billing>(`/workshop/${slug}/billing?days=30`)
      .then(setData)
      .catch((e) => toast.error(e.message));
  }, [slug]);
  const total = data?.days.reduce((s, d) => s + Number(d.total), 0) ?? 0;
  const max = Math.max(1, ...(data?.days.map((d) => Number(d.total)) ?? [1]));
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Faturamento · 30 dias</h2>
      <Card className="p-5 glass shop-ring">
        <div className="text-sm text-muted-foreground">Total do período</div>
        <div className="text-3xl font-extrabold stat-num">{money(total)}</div>
        <div className="mt-6 flex items-end gap-1 h-28">
          {(data?.days ?? []).map((d) => (
            <div
              key={d.day}
              title={`${d.day} · ${money(d.total)}`}
              className="flex-1 rounded-t bg-primary/70 min-w-[4px] transition-all"
              style={{ height: `${Math.max(8, (Number(d.total) / max) * 100)}%` }}
            />
          ))}
        </div>
      </Card>
      <div className="space-y-2">
        {data?.mechanics.map((m) => (
          <Card key={m.name} className="p-4 glass flex justify-between">
            <div>
              <div className="font-medium">{m.name}</div>
              <div className="text-xs text-muted-foreground">{Number(m.count)} OS</div>
            </div>
            <div className="font-bold">{money(m.total)}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Equipe({ slug, manage }: { slug: string; manage: boolean }) {
  const [rows, setRows] = useState<Employee[]>([]);
  const [name, setName] = useState("");
  const [discordId, setDiscordId] = useState("");
  const [roleLabel, setRoleLabel] = useState("");

  async function load() {
    setRows(await api<Employee[]>(`/workshop/${slug}/employees`));
  }
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [slug]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/workshop/${slug}/employees`, { method: "POST", body: JSON.stringify({ name, discordId, roleLabel }) });
      toast.success("Funcionário adicionado");
      setName("");
      setDiscordId("");
      setRoleLabel("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha");
    }
  }

  async function remove(emp: Employee, withBl: boolean) {
    try {
      let body = {};
      if (withBl) {
        const reason = prompt("Motivo da blacklist") ?? "";
        const days = Number(prompt("Dias de bloqueio", "30"));
        if (!reason || !days) return;
        body = { blacklist: { reason, days } };
      }
      await api(`/workshop/${slug}/employees/${emp.id}`, { method: "DELETE", body: JSON.stringify(body) });
      toast.success(withBl ? "Removido e na blacklist" : "Removido");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha");
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Equipe</h2>
      {manage && (
        <Card className="p-4 glass">
          <form onSubmit={add} className="grid md:grid-cols-4 gap-2">
            <Input placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} required />
            <Input placeholder="Discord ID" value={discordId} onChange={(e) => setDiscordId(e.target.value.replace(/\D/g, ""))} required />
            <Input placeholder="Cargo" value={roleLabel} onChange={(e) => setRoleLabel(e.target.value)} />
            <Button>Adicionar</Button>
          </form>
        </Card>
      )}
      {rows.map((e) => (
        <Card key={e.id} className="p-4 glass flex flex-wrap justify-between gap-3">
          <div>
            <div className="font-medium">
              {e.name} <span className="text-xs text-muted-foreground">{e.roleLabel || "—"}</span>
            </div>
            <div className="text-xs text-muted-foreground">Discord {e.discordId} · {e.status}</div>
          </div>
          {manage && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void remove(e, false)}>
                Remover
              </Button>
              <Button size="sm" variant="outline" onClick={() => void remove(e, true)}>
                Blacklist
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function Hierarquia({ slug, manage }: { slug: string; manage: boolean }) {
  const [roles, setRoles] = useState<HierarchyRole[]>([]);
  const [emps, setEmps] = useState<Employee[]>([]);

  useEffect(() => {
    api<{ roles: HierarchyRole[]; employees: Employee[] }>(`/workshop/${slug}/hierarchy`)
      .then((d) => {
        setRoles(d.roles.length ? d.roles : [{ label: "Mecânico", nicknamePrefix: "[MEC]", discordRoleId: null }]);
        setEmps(d.employees);
      })
      .catch((e) => toast.error(e.message));
  }, [slug]);

  async function save() {
    try {
      await api(`/workshop/${slug}/hierarchy`, { method: "PUT", body: JSON.stringify({ roles }) });
      toast.success("Hierarquia salva");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    }
  }

  async function push() {
    try {
      await api(`/workshop/${slug}/hierarchy/push`, { method: "POST" });
      toast.success("Enviado ao Discord");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Hierarquia</h2>
        {manage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setRoles((r) => [...r, { label: "", nicknamePrefix: "", discordRoleId: "" }])}>
              Cargo
            </Button>
            <Button onClick={() => void save()}>
              <Save className="w-4 h-4" /> Salvar
            </Button>
            <Button variant="outline" onClick={() => void push()}>
              Sync Discord
            </Button>
          </div>
        )}
      </div>
      {roles.map((r, i) => (
        <Card key={i} className="p-4 glass grid md:grid-cols-3 gap-2">
          <Input
            placeholder="Cargo"
            value={r.label}
            disabled={!manage}
            onChange={(e) => setRoles((list) => list.map((x, n) => (n === i ? { ...x, label: e.target.value } : x)))}
          />
          <Input
            placeholder="Prefixo nick"
            value={r.nicknamePrefix ?? ""}
            disabled={!manage}
            onChange={(e) => setRoles((list) => list.map((x, n) => (n === i ? { ...x, nicknamePrefix: e.target.value } : x)))}
          />
          <Input
            placeholder="ID cargo Discord"
            value={r.discordRoleId ?? ""}
            disabled={!manage}
            onChange={(e) => setRoles((list) => list.map((x, n) => (n === i ? { ...x, discordRoleId: e.target.value } : x)))}
          />
        </Card>
      ))}
      <div className="text-sm text-muted-foreground">{emps.length} funcionários ativos para sincronizar.</div>
    </div>
  );
}

function BlacklistTab({ slug, manage }: { slug: string; manage: boolean }) {
  const [rows, setRows] = useState<Blacklist[]>([]);
  const [employeeName, setEmployeeName] = useState("");
  const [discordId, setDiscordId] = useState("");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(30);

  async function load() {
    setRows(await api<Blacklist[]>(`/workshop/${slug}/blacklist`));
  }
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [slug]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/workshop/${slug}/blacklist`, { method: "POST", body: JSON.stringify({ employeeName, discordId, reason, days }) });
      toast.success("Incluído na blacklist");
      setEmployeeName("");
      setDiscordId("");
      setReason("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha");
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Blacklist</h2>
      {manage && (
        <Card className="p-4 glass">
          <form onSubmit={add} className="grid md:grid-cols-2 gap-2">
            <Input placeholder="Nome" value={employeeName} onChange={(e) => setEmployeeName(e.target.value)} required />
            <Input placeholder="Discord ID" value={discordId} onChange={(e) => setDiscordId(e.target.value.replace(/\D/g, ""))} />
            <Input placeholder="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} required />
            <Input type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value))} />
            <Button className="md:col-span-2">Registrar</Button>
          </form>
        </Card>
      )}
      {rows.map((b) => {
        const left = daysLeft(b.endsAt);
        const active = left > 0;
        return (
          <Card key={b.id} className="p-4 glass flex justify-between gap-3">
            <div>
              <div className="font-medium">
                {b.employeeName}{" "}
                <span className={`text-xs ${active ? "text-destructive" : "text-muted-foreground"}`}>
                  {active ? `${left} dias restantes` : "encerrada"}
                </span>
              </div>
              <div className="text-sm text-muted-foreground mt-1">{b.reason}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {when(b.startsAt)} → {when(b.endsAt)} · {b.days} dias
              </div>
            </div>
            {manage && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  api(`/workshop/${slug}/blacklist/${b.id}`, { method: "DELETE" })
                    .then(() => load())
                    .catch((e) => toast.error(e.message))
                }
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function Estoque({ slug, manage }: { slug: string; manage: boolean }) {
  const [rows, setRows] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState(0);
  const [stock, setStock] = useState(0);

  async function load() {
    setRows(await api<Product[]>(`/workshop/${slug}/products`));
  }
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [slug]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Estoque</h2>
      {manage && (
        <Card className="p-4 glass">
          <form
            className="grid md:grid-cols-4 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              api(`/workshop/${slug}/products`, { method: "POST", body: JSON.stringify({ name, price, stock }) })
                .then(() => {
                  toast.success("Peça cadastrada");
                  setName("");
                  void load();
                })
                .catch((err) => toast.error(err.message));
            }}
          >
            <Input placeholder="Peça" value={name} onChange={(e) => setName(e.target.value)} required />
            <Input type="number" placeholder="Preço" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
            <Input type="number" placeholder="Estoque" value={stock} onChange={(e) => setStock(Number(e.target.value))} />
            <Button>Adicionar</Button>
          </form>
        </Card>
      )}
      {rows.map((p) => (
        <Card key={p.id} className="p-4 glass flex justify-between">
          <div>
            <div className="font-medium">{p.name}</div>
            <div className="text-xs text-muted-foreground">
              {money(p.price)} · {p.stock} un.
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Ponto({ slug }: { slug: string }) {
  const [rows, setRows] = useState<PontoRow[]>([]);
  useEffect(() => {
    api<PontoRow[]>(`/workshop/${slug}/ponto`)
      .then(setRows)
      .catch((e) => toast.error(e.message));
  }, [slug]);
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-bold">Ponto</h2>
      {rows.map((r) => (
        <Card key={r.id} className="p-4 glass flex justify-between text-sm">
          <div>
            Discord {r.discordId}
            <div className="text-xs text-muted-foreground">
              {when(r.openedAt)} {r.closedAt ? `→ ${when(r.closedAt)}` : "· em aberto"}
            </div>
          </div>
          <span className={r.closedAt ? "text-muted-foreground" : "text-emerald-400"}>
            {r.closedAt ? "Fechado" : "Aberto"}
          </span>
        </Card>
      ))}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum ponto registrado.</p>}
    </div>
  );
}

function Farm({ slug, manage }: { slug: string; manage: boolean }) {
  const [rows, setRows] = useState<FarmRow[]>([]);
  async function load() {
    setRows(await api<FarmRow[]>(`/workshop/${slug}/farm`));
  }
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [slug]);
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-bold">Farm</h2>
      {rows.map((r) => (
        <Card key={r.id} className="p-4 glass flex flex-wrap justify-between gap-3 text-sm">
          <div>
            Discord {r.discordId} · <strong>{r.amount}</strong>
            <div className="text-xs text-muted-foreground">
              {when(r.createdAt)} · {r.status}
            </div>
          </div>
          {manage && r.status === "pending" && (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  api(`/workshop/${slug}/farm/${r.id}`, { method: "PATCH", body: JSON.stringify({ status: "approved" }) }).then(load)
                }
              >
                Aprovar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  api(`/workshop/${slug}/farm/${r.id}`, { method: "PATCH", body: JSON.stringify({ status: "rejected" }) }).then(load)
                }
              >
                Recusar
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
