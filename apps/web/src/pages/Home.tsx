import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, LogIn, LogOut, Sparkles } from "lucide-react";
import { useAuth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/modal";
import { api, setToken, type Me, type Workshop } from "@/lib/api";
import { brandOf } from "@/lib/brands";

const FALLBACK: Workshop[] = [
  { id: "reds", slug: "reds", name: "Reds", primaryColor: "#dc2626" },
  { id: "tuner", slug: "tuner", name: "Tuner", primaryColor: "#2563eb" },
  { id: "power", slug: "power", name: "Power", primaryColor: "#ca8a04" },
  { id: "motoclube", slug: "motoclube", name: "Motoclube", primaryColor: "#16a34a" },
];

export function HomePage() {
  const { me, loading, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [authOpen, setAuthOpen] = useState(false);
  const [shops, setShops] = useState<Workshop[]>(FALLBACK);

  useEffect(() => {
    api<Workshop[]>("/workshops")
      .then(setShops)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (loading || !me) return;
    if (!me.approved && !me.isOwner) {
      navigate("/pendente", { replace: true });
      return;
    }
    if (me.isAdmin || me.isDonoMec) navigate("/admin", { replace: true });
    else if (me.employee) navigate(`/oficina/${me.employee.workshopSlug}`, { replace: true });
  }, [me, loading, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[42rem] h-[42rem] rounded-full bg-primary/15 blur-3xl glow-orb" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[28rem] h-[28rem] rounded-full bg-red-900/20 blur-3xl" />
      </div>

      <div className="absolute top-4 right-4 z-20 anim-in">
        {me ? (
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            <LogOut className="w-4 h-4" /> Sair
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAuthOpen(true)}>
            <LogIn className="w-4 h-4" /> Entrar
          </Button>
        )}
      </div>

      <div className="max-w-4xl w-full mx-auto flex flex-col items-center gap-8 relative z-10">
        <div className="text-center space-y-4 anim-up">
          <img src="/favicon.png" alt="SCC" className="w-16 h-16 mx-auto rounded-2xl shop-ring logo-float object-cover" />
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/80 border border-border text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5 text-primary" /> Sistema SCC
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight">
            SCC <span className="text-primary">Mecânicas</span>
          </h1>
          <p className="text-muted-foreground text-sm md:text-base max-w-lg mx-auto">
            Painel exclusivo de cada oficina. Cadastro no site, liberação pelo admin, operação completa.
          </p>
        </div>

        {loading && <Card className="w-full p-4 text-center text-sm text-muted-foreground glass">Carregando…</Card>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
          {shops.map((w, i) => {
            const b = brandOf(w.slug);
            return (
              <Card
                key={w.id}
                className={`p-5 glass hover-lift anim-up delay-${i + 1} text-center`}
                style={{ "--shop": w.primaryColor || b.color } as React.CSSProperties}
              >
                <img src={b.logo} alt={w.name} className="h-20 md:h-24 mx-auto object-contain drop-shadow-lg" />
                <h2 className="text-lg font-bold mt-3">{w.name}</h2>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">{b.tag}</p>
              </Card>
            );
          })}
        </div>

        {!me && (
          <Button className="mt-1 gap-2 anim-up delay-4 px-6" onClick={() => setAuthOpen(true)}>
            Entrar ou cadastrar <ArrowRight className="w-4 h-4" />
          </Button>
        )}
      </div>

      {authOpen && (
        <AuthDialog
          onClose={() => setAuthOpen(false)}
          onLogged={async () => {
            setAuthOpen(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function AuthDialog({ onClose, onLogged }: { onClose: () => void; onLogged: () => Promise<void> }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  return (
    <Modal onClose={onClose} className="max-w-md">
        <div>
          <h2 className="text-lg font-semibold">{mode === "signin" ? "Entrar" : "Criar conta"}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "signin"
              ? "Usuário e senha. Se ainda não liberaram, você verá a tela de espera."
              : "Cadastro no site. Um admin libera o acesso da mecânica."}
          </p>
        </div>
        {mode === "signin" ? <SignInForm onDone={onLogged} /> : <SignUpForm onDone={() => setMode("signin")} />}
        <div className="text-center text-sm text-muted-foreground pt-2 border-t">
          {mode === "signin" ? (
            <>
              Não tem conta?{" "}
              <button type="button" className="text-primary font-medium" onClick={() => setMode("signup")}>
                Criar conta
              </button>
            </>
          ) : (
            <>
              Já tem conta?{" "}
              <button type="button" className="text-primary font-medium" onClick={() => setMode("signin")}>
                Entrar
              </button>
            </>
          )}
        </div>
    </Modal>
  );
}

function SignInForm({ onDone }: { onDone: () => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api<{ token: string; me: Me }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setToken(res.token);
      toast.success("Bem-vindo!");
      await onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label>Usuário</Label>
        <Input value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))} required />
      </div>
      <div className="space-y-1.5">
        <Label>Senha</Label>
        <Input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <Button className="w-full" disabled={loading}>
        {loading ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}

function SignUpForm({ onDone }: { onDone: () => void }) {
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [discordId, setDiscordId] = useState("");
  const [workshopId, setWorkshopId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<Workshop[]>("/workshops")
      .then(setWorkshops)
      .catch(() => toast.error("Não foi possível carregar as mecânicas"));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!workshopId) return toast.error("Escolha a mecânica");
    setLoading(true);
    try {
      await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({ username, password, discordId, workshopId }),
      });
      toast.success("Cadastro enviado. Aguarde um admin liberar.");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no cadastro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label>Mecânica</Label>
        <select
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          value={workshopId}
          onChange={(e) => setWorkshopId(e.target.value)}
          required
        >
          <option value="">Selecione</option>
          {workshops.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label>Usuário</Label>
        <Input value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))} required />
      </div>
      <div className="space-y-1.5">
        <Label>Discord ID</Label>
        <Input value={discordId} onChange={(e) => setDiscordId(e.target.value.replace(/\D/g, ""))} required />
      </div>
      <div className="space-y-1.5">
        <Label>Senha</Label>
        <Input type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <Button className="w-full" disabled={loading}>
        {loading ? "Enviando…" : "Cadastrar"}
      </Button>
    </form>
  );
}
