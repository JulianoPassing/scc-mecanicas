import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, LogIn, LogOut, Sparkles, Wrench } from "lucide-react";
import { useAuth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, setToken, type Me, type Workshop } from "@/lib/api";

export function HomePage() {
  const { me, loading, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [authOpen, setAuthOpen] = useState(false);

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
      <div className="absolute inset-0 bg-gradient-to-b from-black via-zinc-950 to-black" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />

      <div className="absolute top-4 right-4 z-20">
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

      <div className="max-w-3xl w-full mx-auto flex flex-col items-center gap-6 relative z-10">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5 text-primary" /> Sistema SCC
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
            SCC <span className="text-primary">Mecânicas</span>
          </h1>
          <p className="text-muted-foreground text-sm md:text-base max-w-lg mx-auto">
            Cadastro no site. Um admin libera o acesso. Cada oficina tem a sua área.
          </p>
        </div>

        {loading && (
          <Card className="w-full p-4 text-center text-sm text-muted-foreground">Carregando…</Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full mt-2">
          {(["Reds", "Tuner", "Power", "Motoclube"] as const).map((name) => (
            <Card key={name} className="p-6 bg-card/80 backdrop-blur border-border">
              <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3">
                <Wrench className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold">{name}</h2>
              <p className="text-muted-foreground text-sm mt-1">Área da mecânica — entre após a liberação.</p>
            </Card>
          ))}
        </div>

        {!me && (
          <Button className="mt-2 gap-2" onClick={() => setAuthOpen(true)}>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <Card className="w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
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
      </Card>
    </div>
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
