import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Ban,
  Clock3,
  ShieldCheck,
  LayoutDashboard,
  List,
  RefreshCw,
  ScrollText,
  UserPlus,
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
import { Modal } from "@/components/modal";
import {
  api,
  type AdminUser,
  type AuditLog,
  type Billing,
  type Blacklist,
  type CatalogItem,
  type Employee,
  type FarmWeek,
  type HierarchyRole,
  type OrderItem,
  type PontoRow,
  type PlateHistory,
  type Product,
  type ServiceOrder,
  type Whitelist,
  type Summary,
} from "@/lib/api";
import { brandOf, daysLeft, money, when } from "@/lib/brands";
import { cargoFromUserRoles, DEFAULT_CARGOS, groupTeamByCargo, isDonoCargo, isGerenteCargo } from "@/lib/cargos";

function Splash() {
  return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
      <img src="/favicon.png" alt="" className="w-10 h-10 mr-3 rounded-xl logo-float" />
      Carregando painel…
    </div>
  );
}

type Tab =
  | "resumo"
  | "os"
  | "faturamento"
  | "cadastros"
  | "equipe"
  | "hierarquia"
  | "blacklist"
  | "whitelist"
  | "catalogo"
  | "estoque"
  | "ponto"
  | "farm"
  | "logs";

const TABS: { id: Tab; label: string; icon: typeof Wrench }[] = [
  { id: "resumo", label: "Resumo", icon: LayoutDashboard },
  { id: "os", label: "Ordens de serviço", icon: Wrench },
  { id: "faturamento", label: "Faturamento", icon: Wallet },
  { id: "cadastros", label: "Cadastros", icon: UserPlus },
  { id: "equipe", label: "Equipe", icon: Users },
  { id: "hierarquia", label: "Hierarquia", icon: Receipt },
  { id: "blacklist", label: "Blacklist", icon: Ban },
  { id: "whitelist", label: "Whitelist", icon: ShieldCheck },
  { id: "catalogo", label: "Catálogo", icon: List },
  { id: "estoque", label: "Estoque", icon: Package },
  { id: "ponto", label: "Ponto", icon: Clock3 },
  { id: "farm", label: "Farm", icon: Sprout },
  { id: "logs", label: "Logs", icon: ScrollText },
];

export function OficinaPage() {
  const { slug } = useParams();
  const { me, loading, logout, refresh } = useAuth();
  const [tab, setTab] = useState<Tab>("resumo");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [denied, setDenied] = useState(false);
  const warnedPending = useRef(false);

  const brand = brandOf(slug);

  useEffect(() => {
    void refresh();
  }, [slug]);

  useEffect(() => {
    if (!slug || !me) return;
    api<Summary>(`/workshop/${slug}/summary`)
      .then((s) => {
        setDenied(false);
        setSummary(s);
        const pending = s.pendingSignups ?? 0;
        const canWarn =
          me.isAdmin || (me.manageWorkshops ?? []).includes(s.workshop.id) || me.isDonoMec || me.isManager;
        if (pending > 0 && canWarn && !warnedPending.current) {
          warnedPending.current = true;
          toast.message(
            pending === 1 ? "1 cadastro aguardando liberação" : `${pending} cadastros aguardando liberação`,
          );
        }
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
  const shopId = summary?.workshop.id;
  const manage =
    me.isAdmin || (!!shopId && (me.manageWorkshops ?? []).includes(shopId)) || (!shopId && (me.isDonoMec || me.isManager));
  const isShopDono = me.isAdmin || (!!shopId && (me.donoWorkshops ?? []).includes(shopId)) || (!shopId && me.isDonoMec);
  const canApproveSignups = manage;
  const tabs = TABS.filter((t) => t.id !== "cadastros" || canApproveSignups);

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
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`nav-btn w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm ${
                tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <t.icon className="w-4 h-4" /> {t.label}
              {t.id === "cadastros" && (summary?.pendingSignups ?? 0) > 0 && (
                <span className="ml-auto min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                  {summary?.pendingSignups}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t space-y-2">
          {manage && (
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
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs ${tab === t.id ? "bg-primary text-white" : "bg-secondary text-muted-foreground"}`}
            >
              {t.label}
              {t.id === "cadastros" && (summary?.pendingSignups ?? 0) > 0 ? ` (${summary?.pendingSignups})` : ""}
            </button>
          ))}
        </div>

        <main className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
          {canApproveSignups && (summary?.pendingSignups ?? 0) > 0 && tab !== "cadastros" && (
            <button
              type="button"
              onClick={() => setTab("cadastros")}
              className="w-full text-left rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 glass"
            >
              <div className="font-semibold">
                {summary!.pendingSignups === 1
                  ? "1 cadastro aguardando liberação"
                  : `${summary!.pendingSignups} cadastros aguardando liberação`}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Clique para abrir Cadastros e liberar o acesso.</div>
            </button>
          )}
          {tab === "resumo" && <Resumo slug={slug!} summary={summary} onOpenCadastros={() => setTab("cadastros")} />}
          {tab === "os" && <Ordens slug={slug!} canDelete={manage} />}
          {tab === "faturamento" && <Faturamento slug={slug!} />}
          {tab === "cadastros" && canApproveSignups && summary && (
            <Cadastros workshopId={summary.workshop.id} workshopName={summary.workshop.name} canEditDono={isShopDono} />
          )}
          {tab === "equipe" && <Equipe slug={slug!} manage={manage} canEditDono={isShopDono} />}
          {tab === "hierarquia" && <Hierarquia slug={slug!} manage={manage} />}
          {tab === "blacklist" && <BlacklistTab slug={slug!} manage={manage} />}
          {tab === "whitelist" && <WhitelistTab slug={slug!} manage={manage} />}
          {tab === "catalogo" && <Catalogo slug={slug!} manage={manage} />}
          {tab === "estoque" && <Estoque slug={slug!} manage={manage} />}
          {tab === "ponto" && <Ponto slug={slug!} manage={manage} />}
          {tab === "farm" && <Farm slug={slug!} manage={manage} />}
          {tab === "logs" && <Logs slug={slug!} isOwner={me.isOwner} />}
        </main>
      </div>
    </div>
  );
}

function Resumo({
  slug,
  summary,
  onOpenCadastros,
}: {
  slug: string;
  summary: Summary | null;
  onOpenCadastros?: () => void;
}) {
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
          {
            label: "Cadastros",
            value: String(summary?.pendingSignups ?? 0),
            sub: "aguardando liberação",
            onClick: (summary?.pendingSignups ?? 0) > 0 ? onOpenCadastros : undefined,
          },
          { label: "Farm", value: String(summary?.farmPending ?? 0), sub: "pendentes de confirmação" },
          { label: "Ponto aberto", value: String(summary?.pontoOpen ?? 0), sub: "em expediente agora" },
        ].map((s) => (
          <Card
            key={s.label}
            className={`p-5 glass shop-ring hover-lift ${s.onClick ? "cursor-pointer" : ""}`}
            onClick={s.onClick}
          >
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</div>
            <div className="text-2xl font-extrabold stat-num mt-1">{s.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{s.sub}</div>
          </Card>
        ))}
      </div>
    </>
  );
}

function Ordens({ slug, canDelete }: { slug: string; canDelete: boolean }) {
  const [rows, setRows] = useState<ServiceOrder[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ServiceOrder | null>(null);
  const [history, setHistory] = useState<PlateHistory | null>(null);

  async function load() {
    setRows(await api<ServiceOrder[]>(`/workshop/${slug}/orders${q ? `?q=${encodeURIComponent(q)}` : ""}`));
  }
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [slug]);

  async function openDetail(id: string) {
    try {
      setDetail(await api<ServiceOrder>(`/workshop/${slug}/orders/${id}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    }
  }

  async function openHistory(plate: string) {
    const p = plate.trim().toUpperCase();
    if (!p) {
      toast.error("Informe a placa");
      return;
    }
    try {
      setHistory(await api<PlateHistory>(`/workshop/${slug}/plates/${encodeURIComponent(p)}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Ordens de serviço</h2>
        <div className="flex gap-2">
          <Input placeholder="Placa ou dono" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
          <Button variant="outline" onClick={() => void load()}>
            Buscar
          </Button>
          <Button variant="outline" onClick={() => void openHistory(q)}>
            Histórico da placa
          </Button>
          <Button onClick={() => setOpen(true)}>
            <Plus className="w-4 h-4" /> Nova OS
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {rows.map((o) => (
          <Card
            key={o.id}
            className="p-4 glass flex flex-wrap items-center justify-between gap-3 hover-lift cursor-pointer"
            onClick={() => void openDetail(o.id)}
          >
            <div>
              <div className="font-semibold">
                {o.plate} <span className="text-muted-foreground font-normal">· {o.clientName}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Mecânico {o.mechanicName} · {when(o.createdAt)}
              </div>
            </div>
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="outline" onClick={() => void openHistory(o.plate)}>
                Histórico
              </Button>
              <div className="font-bold text-primary">{money(o.total)}</div>
              {canDelete && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!confirm(`Apagar a OS da placa ${o.plate}? O registro fica nos Logs.`)) return;
                    api(`/workshop/${slug}/orders/${o.id}`, { method: "DELETE" })
                      .then(() => {
                        toast.success("OS apagada. Ficou no log.");
                        void load();
                      })
                      .catch((e) => toast.error(e.message));
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
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
      {detail && (
        <Modal onClose={() => setDetail(null)}>
          <h3 className="text-lg font-bold">OS · {detail.plate}</h3>
          <p className="text-sm text-muted-foreground">
            Dono {detail.clientName} · Mecânico {detail.mechanicName} · {when(detail.createdAt)}
            {detail.paymentMethod ? ` · ${detail.paymentMethod}` : ""}
          </p>
          <div className="space-y-2">
            {(detail.items ?? []).map((it, i) => (
              <div key={i} className="flex justify-between text-sm border-b border-border/60 pb-2">
                <span>
                  {kindLabel(it.kind)} · {it.name} × {it.quantity}
                </span>
                <span className="font-medium">{money(it.unitPrice * it.quantity)}</span>
              </div>
            ))}
          </div>
          {detail.notes && <p className="text-sm text-muted-foreground">{detail.notes}</p>}
          <div className="text-xl font-extrabold">{money(detail.total)}</div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const plate = detail.plate;
                setDetail(null);
                void openHistory(plate);
              }}
            >
              Histórico da placa
            </Button>
            <Button variant="outline" onClick={() => setDetail(null)}>
              Fechar
            </Button>
            {canDelete && (
              <Button
                variant="outline"
                onClick={() => {
                  if (!confirm(`Apagar a OS da placa ${detail.plate}? O registro fica nos Logs.`)) return;
                  api(`/workshop/${slug}/orders/${detail.id}`, { method: "DELETE" })
                    .then(() => {
                      toast.success("OS apagada. Ficou no log.");
                      setDetail(null);
                      void load();
                    })
                    .catch((e) => toast.error(e.message));
                }}
              >
                <Trash2 className="w-4 h-4" /> Apagar
              </Button>
            )}
          </div>
        </Modal>
      )}
      {history && (
        <HistoricoPlaca
          history={history}
          onClose={() => setHistory(null)}
          onOpenOrder={(id) => {
            setHistory(null);
            void openDetail(id);
          }}
        />
      )}
    </div>
  );
}

function HistoricoPlaca({
  history,
  onClose,
  onOpenOrder,
}: {
  history: PlateHistory;
  onClose: () => void;
  onOpenOrder: (id: string) => void;
}) {
  return (
    <Modal onClose={onClose} className="max-w-2xl">
      <h3 className="text-lg font-bold">Histórico · {history.plate}</h3>
      <p className="text-sm text-muted-foreground">
        {history.count} OS · total {money(history.total)}
        {history.lastClient ? ` · último dono ${history.lastClient}` : ""}
      </p>
      {history.orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma OS nesta placa nesta mecânica.</p>
      ) : (
        <div className="space-y-3 max-h-[60vh] overflow-auto pr-1">
          {history.orders.map((o) => (
            <button
              key={o.id}
              type="button"
              className="w-full text-left rounded-lg border border-border/60 p-3 hover:bg-accent/40"
              onClick={() => onOpenOrder(o.id)}
            >
              <div className="flex justify-between gap-2">
                <div className="font-medium">{o.clientName}</div>
                <div className="font-bold text-primary">{money(o.total)}</div>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Mecânico {o.mechanicName} · {when(o.createdAt)}
                {o.paymentMethod ? ` · ${o.paymentMethod}` : ""}
              </div>
              <div className="text-xs text-muted-foreground mt-2 space-y-1">
                {(o.items ?? []).map((it, i) => (
                  <div key={i}>
                    {kindLabel(it.kind)} · {it.name} × {it.quantity}
                  </div>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}
      <Button variant="outline" onClick={onClose}>
        Fechar
      </Button>
    </Modal>
  );
}

function kindLabel(k: string) {
  if (k === "install") return "Instalar";
  if (k === "remove") return "Remover";
  if (k === "repair") return "Reparo";
  if (k === "product") return "Peça";
  return k;
}

function NovaOs({ slug, onClose, onSaved }: { slug: string; onClose: () => void; onSaved: () => void }) {
  const [clientName, setClientName] = useState("");
  const [plate, setPlate] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Dinheiro");
  const [items, setItems] = useState<OrderItem[]>([{ kind: "install", name: "", quantity: 1, unitPrice: 0 }]);
  const [products, setProducts] = useState<Product[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [plateHint, setPlateHint] = useState<PlateHistory | null>(null);

  useEffect(() => {
    api<Product[]>(`/workshop/${slug}/products`).then(setProducts).catch(() => {});
    api<CatalogItem[]>(`/workshop/${slug}/catalog`).then(setCatalog).catch(() => {});
  }, [slug]);

  const total = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api(`/workshop/${slug}/orders`, {
        method: "POST",
        body: JSON.stringify({ clientName, plate, notes, paymentMethod, items }),
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
    <Modal onClose={onClose}>
      <h3 className="text-lg font-bold">Nova ordem de serviço</h3>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Dono do veículo</Label>
            <Input value={clientName} onChange={(e) => setClientName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label>Placa</Label>
            <Input
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              onBlur={() => {
                const p = plate.trim().toUpperCase();
                if (p.length < 3) {
                  setPlateHint(null);
                  return;
                }
                api<PlateHistory>(`/workshop/${slug}/plates/${encodeURIComponent(p)}`)
                  .then((h) => setPlateHint(h.count ? h : null))
                  .catch(() => setPlateHint(null));
              }}
              required
            />
            {plateHint && plateHint.count > 0 && (
              <p className="text-xs text-muted-foreground">
                Já tem {plateHint.count} OS nesta placa · último dono {plateHint.lastClient || "—"} · {money(plateHint.total)}
              </p>
            )}
          </div>
        </div>
        <div className="space-y-2">
          {items.map((it, i) => {
            const opts = catalog.filter((c) => c.kind === it.kind);
            return (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <select
                  className="col-span-3 h-9 rounded-md border border-input bg-transparent px-2 text-xs"
                  value={it.kind}
                  onChange={(e) => {
                    const kind = e.target.value as OrderItem["kind"];
                    setItems((list) => list.map((x, n) => (n === i ? { ...x, kind, name: "", unitPrice: 0 } : x)));
                  }}
                >
                  <option value="install">Instalar</option>
                  <option value="remove">Remover</option>
                  <option value="repair">Reparo</option>
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
                ) : opts.length > 0 ? (
                  <select
                    className="col-span-5 h-9 rounded-md border border-input bg-transparent px-2 text-xs"
                    value={it.name}
                    onChange={(e) => {
                      const c = opts.find((x) => x.name === e.target.value);
                      setItems((list) =>
                        list.map((x, n) => (n === i ? { ...x, name: e.target.value, unitPrice: c?.price ?? x.unitPrice } : x)),
                      );
                    }}
                  >
                    <option value="">Serviço do catálogo</option>
                    {opts.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name} ({money(c.price)})
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    className="col-span-5"
                    placeholder="Serviço (cadastre no Catálogo)"
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
            );
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setItems((l) => [...l, { kind: "install", name: "", quantity: 1, unitPrice: 0 }])}
          >
            <Plus className="w-3 h-3" /> Item
          </Button>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Pagamento</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option>Dinheiro</option>
              <option>PIX</option>
              <option>Cartão</option>
              <option>Transferência</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>Obs.</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
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
    </Modal>
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

function Cadastros({
  workshopId,
  workshopName,
  canEditDono,
}: {
  workshopId: string;
  workshopName: string;
  canEditDono: boolean;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<Record<string, string>>({});

  async function load() {
    const all = await api<AdminUser[]>("/admin/users");
    setUsers(all.filter((u) => u.requestedWorkshopId === workshopId || u.roles.some((r) => r.workshopId === workshopId)));
  }
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [workshopId]);

  async function approve(u: AdminUser, approved: boolean) {
    try {
      const cargoLabel = roles[u.id] || "Mecânico";
      await api(`/admin/users/${u.id}/approve`, {
        method: "POST",
        body: JSON.stringify({
          approved,
          cargoLabel: approved ? cargoLabel : undefined,
          role: approved
            ? isDonoCargo(cargoLabel)
              ? "dono_mec"
              : isGerenteCargo(cargoLabel)
                ? "manager_mec"
                : "mechanic"
            : undefined,
          workshopId,
        }),
      });
      toast.success(approved ? "Acesso liberado" : "Acesso revogado");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Cadastros · {workshopName}</h2>
      <p className="text-sm text-muted-foreground">
        Quem pediu esta mecânica. Liberar coloca na equipe com o cargo escolhido. Depois o cargo se altera em Equipe.
      </p>
      {users.map((u) => (
        <Card key={u.id} className="p-4 glass flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-medium">
              {u.username} <span className="text-muted-foreground font-normal">· Discord {u.discordId}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {u.approved ? "Liberado" : "Pendente"} · {u.roles.map((r) => r.role).join(", ") || "sem cargo"}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              value={roles[u.id] ?? cargoFromUserRoles(u.roles, workshopId)}
              onChange={(e) => setRoles((s) => ({ ...s, [u.id]: e.target.value }))}
            >
              {DEFAULT_CARGOS.filter((c) => canEditDono || !isDonoCargo(c.label)).map((c) => (
                <option key={c.label} value={c.label}>
                  {c.label}
                </option>
              ))}
            </select>
            {u.approved ? (
              (canEditDono || !u.roles.some((r) => r.role === "dono_mec" && r.workshopId === workshopId)) && (
                <Button size="sm" variant="outline" onClick={() => void approve(u, false)}>
                  Revogar
                </Button>
              )
            ) : (
              <Button size="sm" onClick={() => void approve(u, true)}>
                Liberar
              </Button>
            )}
            {canEditDono && !u.roles.some((r) => r.role === "owner") && (
              <Button
                size="sm"
                variant="outline"
                className="text-red-400 border-red-500/40"
                onClick={() => {
                  if (!confirm(`Excluir a conta ${u.username}?`)) return;
                  api(`/admin/users/${u.id}`, { method: "DELETE" })
                    .then(() => {
                      toast.success("Usuário excluído");
                      void load();
                    })
                    .catch((e) => toast.error(e instanceof Error ? e.message : "Falha"));
                }}
              >
                Excluir
              </Button>
            )}
          </div>
        </Card>
      ))}
      {users.length === 0 && <p className="text-sm text-muted-foreground">Nenhum cadastro para esta mecânica.</p>}
    </div>
  );
}

function Equipe({ slug, manage, canEditDono }: { slug: string; manage: boolean; canEditDono: boolean }) {
  const [rows, setRows] = useState<Employee[]>([]);
  const [name, setName] = useState("");
  const [discordId, setDiscordId] = useState("");
  const [roleLabel, setRoleLabel] = useState("Mecânico");
  const [syncing, setSyncing] = useState(false);
  const [bl, setBl] = useState<{ emp: Employee; reason: string; days: number } | null>(null);
  const [drop, setDrop] = useState<Employee | null>(null);

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
      setRoleLabel("Mecânico");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha");
    }
  }

  async function setCargo(emp: Employee, next: string) {
    try {
      await api(`/workshop/${slug}/employees/${emp.id}`, { method: "PATCH", body: JSON.stringify({ roleLabel: next }) });
      toast.success(`${emp.discordNick || emp.name} agora é ${next}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha");
    }
  }

  async function remove(emp: Employee, withBl: boolean) {
    try {
      if (withBl) {
        setBl({ emp, reason: "", days: 30 });
        return;
      }
      await api(`/workshop/${slug}/employees/${emp.id}`, { method: "DELETE", body: JSON.stringify({}) });
      toast.success("Removido da equipe");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha");
    }
  }

  async function confirmDeleteUser() {
    if (!drop) return;
    try {
      const r = await api<{ deletedUser?: boolean }>(`/workshop/${slug}/employees/${drop.id}`, {
        method: "DELETE",
        body: JSON.stringify({ deleteUser: true }),
      });
      toast.success(r.deletedUser ? "Usuário excluído do site e da equipe" : "Removido da equipe e acesso revogado");
      setDrop(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha");
    }
  }

  async function confirmBlacklist() {
    if (!bl) return;
    if (!bl.reason.trim() || bl.days < 1) return toast.error("Informe motivo e dias");
    try {
      await api(`/workshop/${slug}/employees/${bl.emp.id}`, {
        method: "DELETE",
        body: JSON.stringify({ blacklist: { reason: bl.reason.trim(), days: bl.days } }),
      });
      toast.success("Blacklist + removido da equipe. Kick no Discord enfileirado.");
      setBl(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Equipe</h2>
        {manage && (
          <Button
            variant="outline"
            disabled={syncing}
            onClick={() => {
              void (async () => {
                setSyncing(true);
                try {
                  const started = await api<{ actionId: string; queued: number }>(`/workshop/${slug}/employees/sync-nicks`, {
                    method: "POST",
                  });
                  if (!started.queued) {
                    toast.error("Nenhum funcionário ativo com Discord ID para ler.");
                    return;
                  }
                  toast.message(`Lendo apelidos no Discord (${started.queued})…`);
                  const deadline = Date.now() + 70_000;
                  let last: { status: string; updated: number; missing: string[]; error: string | null } | null = null;
                  while (Date.now() < deadline) {
                    await new Promise((r) => setTimeout(r, 2000));
                    const status = await api<{
                      status: string;
                      updated: number;
                      missing: string[];
                      error: string | null;
                    }>(`/workshop/${slug}/employees/sync-nicks/${started.actionId}`);
                    last = status;
                    if (status.status === "sent" || status.status === "failed") break;
                  }
                  await load();
                  if (last?.status === "sent") {
                    const miss = last.missing?.length ?? 0;
                    toast.success(
                      miss
                        ? `Atualizou ${last.updated} de ${started.queued}. ${miss} não estão neste Discord.`
                        : `Atualizou ${last.updated} apelido${last.updated === 1 ? "" : "s"} do Discord.`,
                    );
                  } else if (last?.status === "failed") {
                    toast.error(last.error || "O bot não conseguiu ler os apelidos.");
                  } else {
                    toast.error("O bot não respondeu a tempo. Confira se ele está online neste servidor.");
                  }
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Falha");
                } finally {
                  setSyncing(false);
                }
              })();
            }}
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando…" : "Sync apelidos do Discord"}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Quem fez cadastro e foi liberado entra sozinho. O cargo se altera aqui; a Hierarquia só organiza essa mesma lista.
      </p>
      {manage && (
        <Card className="p-4 glass">
          <form onSubmit={add} className="grid md:grid-cols-4 gap-2">
            <Input placeholder="Nome (sem cadastro)" value={name} onChange={(e) => setName(e.target.value)} required />
            <Input placeholder="Discord ID" value={discordId} onChange={(e) => setDiscordId(e.target.value.replace(/\D/g, ""))} required />
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={roleLabel}
              onChange={(e) => setRoleLabel(e.target.value)}
            >
              {DEFAULT_CARGOS.filter((c) => canEditDono || !isDonoCargo(c.label)).map((c) => (
                <option key={c.label} value={c.label}>
                  {c.label}
                </option>
              ))}
            </select>
            <Button>Adicionar</Button>
          </form>
        </Card>
      )}
      {(() => {
        const { groups, leftover } = groupTeamByCargo(rows);
        const blocks = [
          ...groups.map((g) => ({ label: g.label, members: g.members })),
          ...(leftover.length ? [{ label: "Sem cargo", members: leftover }] : []),
        ];
        return blocks.map((block) => (
          <div key={block.label} className="space-y-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {block.label} · {block.members.length}
            </h3>
            {block.members.length === 0 && <p className="text-xs text-muted-foreground px-1">Ninguém neste cargo.</p>}
            {block.members.map((e) => (
              <Card key={e.id} className="p-4 glass flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{e.discordNick || e.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {e.name}
                    {e.discordNick && e.discordNick !== e.name ? ` · apelido ${e.discordNick}` : ""} · Discord {e.discordId}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {manage && (
                    <select
                      className="h-9 min-w-[180px] rounded-md border border-input bg-transparent px-2 text-sm"
                      disabled={!canEditDono && isDonoCargo(e.roleLabel)}
                      value={e.roleLabel ?? "Mecânico"}
                      onChange={(ev) => void setCargo(e, ev.target.value)}
                    >
                      {DEFAULT_CARGOS.filter((c) => canEditDono || !isDonoCargo(c.label)).map((c) => (
                        <option key={c.label} value={c.label}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {manage && (canEditDono || !isDonoCargo(e.roleLabel)) && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => void remove(e, false)}>
                        Remover
                      </Button>
                      {canEditDono && (
                        <Button size="sm" variant="outline" className="text-red-400 border-red-500/40" onClick={() => setDrop(e)}>
                          Excluir usuário
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => void remove(e, true)}>
                        Blacklist
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            ))}
          </div>
        ));
      })()}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Ninguém liberado nesta mecânica ainda.</p>}
      {drop && (
        <Modal onClose={() => setDrop(null)}>
          <h3 className="text-lg font-bold">Excluir usuário · {drop.discordNick || drop.name}</h3>
          <p className="text-sm text-muted-foreground">
            Tira da equipe e apaga o login do site se a conta só existir nesta mecânica. Não expulsa do Discord (use Blacklist para isso).
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setDrop(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void confirmDeleteUser()}>
              Excluir
            </Button>
          </div>
        </Modal>
      )}
      {bl && (
        <Modal onClose={() => setBl(null)}>
          <h3 className="text-lg font-bold">Blacklist · {bl.emp.discordNick || bl.emp.name}</h3>
          <Label>Motivo</Label>
          <Input value={bl.reason} onChange={(e) => setBl({ ...bl, reason: e.target.value })} />
          <Label>Dias</Label>
          <Input type="number" min={1} value={bl.days} onChange={(e) => setBl({ ...bl, days: Number(e.target.value) })} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setBl(null)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void confirmBlacklist()}>
              Remover e bloquear
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Hierarquia({ slug, manage }: { slug: string; manage: boolean }) {
  const [roles, setRoles] = useState<HierarchyRole[]>([]);
  const [emps, setEmps] = useState<Employee[]>([]);

  async function reload() {
    const d = await api<{ roles: HierarchyRole[]; employees: Employee[] }>(`/workshop/${slug}/hierarchy`);
    setRoles(d.roles.length ? d.roles : DEFAULT_CARGOS);
    setEmps(d.employees);
  }

  useEffect(() => {
    reload().catch((e) => toast.error(e.message));
  }, [slug]);

  async function save() {
    await api(`/workshop/${slug}/hierarchy`, { method: "PUT", body: JSON.stringify({ roles }) });
  }

  const { groups, leftover } = groupTeamByCargo(emps);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-xl font-bold">Hierarquia</h2>
          <p className="text-sm text-muted-foreground mt-1">
            A mesma equipe, organizada do Proprietario ao Aprendiz. Para mudar cargo, use Equipe.
            Aqui só configura prefixo e cargo do Discord, depois Sync.
          </p>
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                save()
                  .then(() => toast.success("Prefixos e cargos do Discord salvos"))
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Falha"))
              }
            >
              <Save className="w-4 h-4" /> Salvar Discord
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                save()
                  .then(() => api(`/workshop/${slug}/hierarchy/push`, { method: "POST" }))
                  .then(() => toast.success("Enviado ao Discord. O bot aplica nick e cargo."))
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Falha"))
              }
            >
              Sync Discord
            </Button>
          </div>
        )}
      </div>

      {[...groups.map((g) => ({ label: g.label, members: g.members })), ...(leftover.length ? [{ label: "Sem cargo", members: leftover }] : [])].map(
        (block) => {
          const role = roles.find((r) => r.label === block.label);
          const roleIdx = roles.findIndex((r) => r.label === block.label);
          return (
            <Card key={block.label} className="p-4 glass space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">
                  {block.label} <span className="text-sm font-normal text-muted-foreground">· {block.members.length}</span>
                </h3>
              </div>
              {role && manage && (
                <div className="grid md:grid-cols-2 gap-2">
                  <Input
                    placeholder="Prefixo nick (ex.: [GER])"
                    value={role.nicknamePrefix ?? ""}
                    onChange={(e) =>
                      setRoles((list) =>
                        list.map((x, n) => (n === roleIdx ? { ...x, nicknamePrefix: e.target.value } : x)),
                      )
                    }
                  />
                  <Input
                    placeholder="ID do cargo no Discord"
                    value={role.discordRoleId ?? ""}
                    onChange={(e) =>
                      setRoles((list) =>
                        list.map((x, n) => (n === roleIdx ? { ...x, discordRoleId: e.target.value } : x)),
                      )
                    }
                  />
                </div>
              )}
              {block.members.length === 0 ? (
                <p className="text-xs text-muted-foreground">Ninguém neste cargo.</p>
              ) : (
                <div className="space-y-2">
                  {block.members.map((e) => (
                    <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2">
                      <div>
                        <div className="font-medium text-sm">{e.discordNick || e.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {e.name}
                          {e.discordNick && e.discordNick !== e.name ? ` · ${e.discordNick}` : ""} · {e.discordId}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        },
      )}
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
      toast.success("BL registrada. Se tiver Discord ID, remove da equipe e expulsa do servidor.");
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
      <p className="text-sm text-muted-foreground">
        Registrar BL tira da equipe, revoga o login desta oficina (apaga a conta se só existir aqui) e pede ao bot para expulsar do Discord.
      </p>
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

function WhitelistTab({ slug, manage }: { slug: string; manage: boolean }) {
  const [rows, setRows] = useState<Whitelist[]>([]);
  const [name, setName] = useState("");
  const [discordId, setDiscordId] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    setRows(await api<Whitelist[]>(`/workshop/${slug}/whitelist`));
  }
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [slug]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/workshop/${slug}/whitelist`, { method: "POST", body: JSON.stringify({ name, discordId, note }) });
      toast.success("Incluído na whitelist. O Discord recebe o aviso se o webhook estiver no Admin.");
      setName("");
      setDiscordId("");
      setNote("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha");
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Whitelist</h2>
      <p className="text-sm text-muted-foreground">
        Quem está liberado nesta mecânica. Incluir manda embed no webhook de whitelist. Quem está na blacklist ativa não entra.
      </p>
      {manage && (
        <Card className="p-4 glass">
          <form onSubmit={add} className="grid md:grid-cols-2 gap-2">
            <Input placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} required />
            <Input
              placeholder="Discord ID"
              value={discordId}
              onChange={(e) => setDiscordId(e.target.value.replace(/\D/g, ""))}
              required
            />
            <Input
              className="md:col-span-2"
              placeholder="Nota (opcional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button className="md:col-span-2">Liberar na whitelist</Button>
          </form>
        </Card>
      )}
      {rows.map((w) => (
        <Card key={w.id} className="p-4 glass flex flex-wrap justify-between gap-3">
          <div>
            <div className="font-medium">{w.name}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Discord {w.discordId} · {when(w.createdAt)}
            </div>
            {w.note && <div className="text-sm text-muted-foreground mt-1">{w.note}</div>}
          </div>
          {manage && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                api(`/workshop/${slug}/whitelist/${w.id}`, { method: "DELETE" })
                  .then(() => load())
                  .catch((e) => toast.error(e.message))
              }
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </Card>
      ))}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Ninguém na whitelist ainda.</p>}
    </div>
  );
}

function Catalogo({ slug, manage }: { slug: string; manage: boolean }) {
  const [rows, setRows] = useState<CatalogItem[]>([]);
  const [kind, setKind] = useState<CatalogItem["kind"]>("install");
  const [name, setName] = useState("");
  const [price, setPrice] = useState(0);
  const [edit, setEdit] = useState<Record<string, { name: string; price: number }>>({});

  async function load() {
    setRows(await api<CatalogItem[]>(`/workshop/${slug}/catalog`));
  }
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [slug]);

  function draft(r: CatalogItem) {
    return edit[r.id] ?? { name: r.name, price: r.price };
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Catálogo de serviços</h2>
      <p className="text-sm text-muted-foreground">
        Preços de instalar, remover e reparo. A OS busca daqui. Dono e gerente podem ajustar o preço.
      </p>
      {manage && (
        <Card className="p-4 glass">
          <form
            className="grid md:grid-cols-4 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              api(`/workshop/${slug}/catalog`, { method: "POST", body: JSON.stringify({ kind, name, price }) })
                .then(() => {
                  toast.success("Item no catálogo");
                  setName("");
                  void load();
                })
                .catch((err) => toast.error(err.message));
            }}
          >
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as CatalogItem["kind"])}
            >
              <option value="install">Instalar</option>
              <option value="remove">Remover</option>
              <option value="repair">Reparo</option>
            </select>
            <Input placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} required />
            <Input type="number" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
            <Button>Adicionar</Button>
          </form>
        </Card>
      )}
      {rows.map((r) => (
        <Card key={r.id} className="p-4 glass flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-[140px]">
            <div className="font-medium">{r.name}</div>
            <div className="text-xs text-muted-foreground">{kindLabel(r.kind)}</div>
          </div>
          {manage ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-40"
                value={draft(r).name}
                onChange={(e) => setEdit((s) => ({ ...s, [r.id]: { ...draft(r), name: e.target.value } }))}
              />
              <Input
                className="w-28"
                type="number"
                min={0}
                value={draft(r).price}
                onChange={(e) => setEdit((s) => ({ ...s, [r.id]: { ...draft(r), price: Number(e.target.value) } }))}
              />
              <Button
                size="sm"
                onClick={() =>
                  api(`/workshop/${slug}/catalog/${r.id}`, {
                    method: "PATCH",
                    body: JSON.stringify(draft(r)),
                  })
                    .then(() => {
                      toast.success("Catálogo atualizado");
                      setEdit((s) => {
                        const next = { ...s };
                        delete next[r.id];
                        return next;
                      });
                      void load();
                    })
                    .catch((e) => toast.error(e instanceof Error ? e.message : "Falha"))
                }
              >
                <Save className="w-4 h-4" /> Salvar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  api(`/workshop/${slug}/catalog/${r.id}`, { method: "DELETE" })
                    .then(() => load())
                    .catch((e) => toast.error(e.message))
                }
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="font-medium">{money(r.price)}</div>
          )}
        </Card>
      ))}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum item no catálogo ainda.</p>}
    </div>
  );
}

function Estoque({ slug, manage }: { slug: string; manage: boolean }) {
  const [rows, setRows] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState(0);
  const [stock, setStock] = useState(0);
  const [edit, setEdit] = useState<Record<string, { name: string; price: number; stock: number }>>({});

  async function load() {
    setRows(await api<Product[]>(`/workshop/${slug}/products`));
  }
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [slug]);

  function draft(p: Product) {
    return edit[p.id] ?? { name: p.name, price: p.price, stock: p.stock };
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Estoque</h2>
      <p className="text-sm text-muted-foreground">
        A OS baixa a peça pelo nome. Se a OS for apagada, a quantidade volta para o estoque.
      </p>
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
        <Card key={p.id} className="p-4 glass flex flex-wrap items-center justify-between gap-3">
          {manage ? (
            <div className="flex flex-wrap items-center gap-2 w-full">
              <Input
                className="min-w-[140px] flex-1"
                value={draft(p).name}
                onChange={(e) => setEdit((s) => ({ ...s, [p.id]: { ...draft(p), name: e.target.value } }))}
              />
              <Input
                className="w-28"
                type="number"
                min={0}
                value={draft(p).price}
                onChange={(e) => setEdit((s) => ({ ...s, [p.id]: { ...draft(p), price: Number(e.target.value) } }))}
              />
              <Input
                className="w-24"
                type="number"
                min={0}
                value={draft(p).stock}
                onChange={(e) => setEdit((s) => ({ ...s, [p.id]: { ...draft(p), stock: Number(e.target.value) } }))}
              />
              <Button
                size="sm"
                onClick={() =>
                  api(`/workshop/${slug}/products/${p.id}`, {
                    method: "PATCH",
                    body: JSON.stringify(draft(p)),
                  })
                    .then(() => {
                      toast.success("Estoque atualizado");
                      setEdit((s) => {
                        const next = { ...s };
                        delete next[p.id];
                        return next;
                      });
                      void load();
                    })
                    .catch((e) => toast.error(e instanceof Error ? e.message : "Falha"))
                }
              >
                <Save className="w-4 h-4" /> Salvar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!confirm(`Remover ${p.name} do estoque?`)) return;
                  api(`/workshop/${slug}/products/${p.id}`, { method: "DELETE" })
                    .then(() => load())
                    .catch((e) => toast.error(e.message));
                }}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div>
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-muted-foreground">
                {money(p.price)} · {p.stock} un.
              </div>
            </div>
          )}
        </Card>
      ))}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma peça no estoque.</p>}
    </div>
  );
}

function Logs({ slug, isOwner }: { slug: string; isOwner: boolean }) {
  const [rows, setRows] = useState<AuditLog[]>([]);
  async function load() {
    setRows(await api<AuditLog[]>(`/workshop/${slug}/logs`));
  }
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [slug]);
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-bold">Logs da mecânica</h2>
      <p className="text-sm text-muted-foreground">
        Tudo que acontece nesta oficina fica aqui. Ninguém apaga — só o owner geral do sistema.
      </p>
      {rows.map((r) => (
        <Card key={r.id} className="p-4 glass flex flex-wrap justify-between gap-3">
          <div>
            <div className="font-medium">{r.summary}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {r.actorName} · {r.action} · {when(r.createdAt)}
            </div>
          </div>
          {isOwner && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (!confirm("Apagar este log? Só o owner pode fazer isso.")) return;
                api(`/workshop/${slug}/logs/${r.id}`, { method: "DELETE" })
                  .then(() => load())
                  .catch((e) => toast.error(e.message));
              }}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </Card>
      ))}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum log ainda.</p>}
    </div>
  );
}

function Ponto({ slug, manage }: { slug: string; manage: boolean }) {
  const [rows, setRows] = useState<PontoRow[]>([]);
  async function load() {
    setRows(await api<PontoRow[]>(`/workshop/${slug}/ponto`));
  }
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [slug]);
  async function punch(action: "open" | "close", sessionId?: string) {
    try {
      const res = await api<{ status: string; hours?: number }>(`/workshop/${slug}/ponto`, {
        method: "POST",
        body: JSON.stringify({ action, sessionId }),
      });
      if (res.status === "opened") toast.success("Ponto aberto");
      else if (res.status === "closed") toast.success(`Ponto fechado · ${res.hours ?? 0}h`);
      else if (res.status === "already_open") toast.message("Ponto já estava aberto");
      else toast.message("Nenhum ponto aberto");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    }
  }
  const weekOpen = rows.filter((r) => !r.closedAt).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Ponto</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {weekOpen} em aberto · horas da semana a partir de segunda
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void punch("open")}>Bater ponto</Button>
          <Button variant="outline" onClick={() => void punch("close")}>
            Fechar meu ponto
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Também funciona no Discord: `/ponto setup` no canal. Cada batida aparece no canal com início, fim e total, se o webhook de ponto estiver no Admin.
      </p>
      {rows.map((r) => (
        <Card key={r.id} className="p-4 glass flex flex-wrap items-center justify-between gap-3 text-sm">
          <div>
            <div className="font-medium">{r.discordNick || r.employeeName || r.discordId}</div>
            <div className="text-xs text-muted-foreground">
              {r.employeeName && r.discordNick && r.discordNick !== r.employeeName ? `${r.employeeName} · ` : ""}
              Discord {r.discordId}
              {r.roleLabel ? ` · ${r.roleLabel}` : ""}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {when(r.openedAt)} {r.closedAt ? `→ ${when(r.closedAt)}` : "· em aberto"} · {r.hours ?? 0}h nesta batida ·{" "}
              {r.weekHours ?? 0}h na semana
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={r.closedAt ? "text-muted-foreground" : "text-emerald-400"}>
              {r.closedAt ? "Fechado" : "Aberto"}
            </span>
            {manage && !r.closedAt && (
              <Button size="sm" variant="outline" onClick={() => void punch("close", r.id)}>
                Fechar
              </Button>
            )}
          </div>
        </Card>
      ))}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum ponto registrado.</p>}
    </div>
  );
}

function Farm({ slug, manage }: { slug: string; manage: boolean }) {
  const [data, setData] = useState<FarmWeek | null>(null);
  const [goal, setGoal] = useState(300);
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  async function load() {
    const d = await api<FarmWeek>(`/workshop/${slug}/farm`);
    setData(d);
    setGoal(d.goal);
  }
  useEffect(() => {
    load().catch((e) => toast.error(e.message));
  }, [slug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return toast.error("Anexe o print");
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return toast.error("Quantidade inválida");
    setSending(true);
    try {
      const fd = new FormData();
      fd.set("amount", String(Math.floor(n)));
      fd.set("file", file);
      await api(`/workshop/${slug}/farm`, { method: "POST", body: fd });
      toast.success("Farm enviado. Aguarde confirmação.");
      setAmount("");
      setFile(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha");
    } finally {
      setSending(false);
    }
  }

  async function decide(id: string, status: "approved" | "rejected", reason?: string) {
    try {
      await api(`/workshop/${slug}/farm/${id}`, { method: "PATCH", body: JSON.stringify({ status, reason }) });
      toast.success(status === "approved" ? "Confirmado" : "Rejeitado");
      setRejectId(null);
      setRejectReason("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Farm</h2>
        {manage && (
          <div className="flex flex-wrap gap-2">
            <Input className="w-24" type="number" min={0} value={goal} onChange={(e) => setGoal(Number(e.target.value))} />
            <Button
              variant="outline"
              onClick={() =>
                api(`/workshop/${slug}/farm/goal`, { method: "PATCH", body: JSON.stringify({ goal }) })
                  .then(() => {
                    toast.success("Meta salva");
                    void load();
                  })
                  .catch((e) => toast.error(e.message))
              }
            >
              Salvar meta
            </Button>
            <Button
              onClick={() =>
                api(`/workshop/${slug}/farm/report`, { method: "POST" })
                  .then(() => toast.success("Relatório enviado ao canal de farm"))
                  .catch((e) => toast.error(e instanceof Error ? e.message : "Falha"))
              }
            >
              Gerar relatório
            </Button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4 glass">
          <div className="text-xs text-muted-foreground uppercase">Meta semanal</div>
          <div className="text-2xl font-extrabold stat-num">{data?.goal ?? 0}</div>
        </Card>
        <Card className="p-4 glass">
          <div className="text-xs text-muted-foreground uppercase">Confirmados na semana</div>
          <div className="text-2xl font-extrabold stat-num">{data?.confirmedTotal ?? 0}</div>
        </Card>
        <Card className="p-4 glass">
          <div className="text-xs text-muted-foreground uppercase">Cumpriram</div>
          <div className="text-2xl font-extrabold">{data?.met.length ?? 0}</div>
        </Card>
        <Card className="p-4 glass">
          <div className="text-xs text-muted-foreground uppercase">Pendentes</div>
          <div className="text-2xl font-extrabold">{data?.pending ?? 0}</div>
        </Card>
      </div>
      <Card className="p-4 glass">
        <h3 className="font-semibold mb-3">Registrar entrega</h3>
        <form onSubmit={(e) => void submit(e)} className="grid md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <div>
            <Label>Quantidade</Label>
            <Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div>
            <Label>Print</Label>
            <Input
              type="file"
              accept="image/*"
              key={file ? file.name + file.size : "empty"}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>
          <Button disabled={sending}>{sending ? "Enviando…" : "Enviar farm"}</Button>
        </form>
        <p className="text-xs text-muted-foreground mt-2">
          Também dá para pagar no Discord (botão Pagar farm + print no canal). O print fica salvo aqui para conferência.
        </p>
      </Card>
      {!!data?.byEmployee?.length && (
        <Card className="p-4 glass">
          <h3 className="font-semibold mb-2">Semana</h3>
          <div className="space-y-1 text-sm">
            {data.byEmployee.map((e) => (
              <div key={e.discordId} className="flex justify-between gap-2">
                <span>
                  {e.name} {e.total >= (data.goal ?? 0) ? "✓" : ""}
                </span>
                <span className="tabular-nums">
                  {e.total} / {data.goal}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
      {data?.entries.map((r) => (
        <Card key={r.id} className="p-4 glass flex flex-wrap justify-between gap-3 text-sm">
          <div className="flex gap-3 min-w-0">
            {r.proofUrl ? (
              <button type="button" className="shrink-0" onClick={() => setPreview(r.proofUrl!)}>
                <img src={r.proofUrl} alt="" className="w-16 h-16 object-cover rounded-md border border-border" />
              </button>
            ) : (
              <div className="w-16 h-16 rounded-md border border-dashed border-border grid place-items-center text-[10px] text-muted-foreground">
                sem print
              </div>
            )}
            <div>
              <div className="font-medium">
                {r.employeeName || r.discordId} · <strong>{r.amount}</strong>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {when(r.createdAt)} ·{" "}
                {r.status === "approved" ? "CONFIRMADO" : r.status === "rejected" ? "REJEITADO" : "pendente"}
                {r.reviewerName ? ` · ${r.reviewerName}` : ""}
                {r.rejectReason ? ` · ${r.rejectReason}` : ""}
              </div>
            </div>
          </div>
          {manage && r.status === "pending" && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void decide(r.id, "approved")}>
                Confirmar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setRejectId(r.id);
                  setRejectReason("");
                }}
              >
                Rejeitar
              </Button>
            </div>
          )}
        </Card>
      ))}
      {rejectId && (
        <Modal onClose={() => setRejectId(null)}>
          <h3 className="text-lg font-bold">Rejeitar farm</h3>
          <Label>Motivo</Label>
          <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setRejectId(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!rejectReason.trim()) return toast.error("Informe o motivo");
                void decide(rejectId, "rejected", rejectReason.trim());
              }}
            >
              Rejeitar
            </Button>
          </div>
        </Modal>
      )}
      {preview && (
        <Modal onClose={() => setPreview(null)} className="max-w-4xl">
          <img src={preview} alt="Print do farm" className="w-full rounded-md" />
        </Modal>
      )}
    </div>
  );
}
