import { Link, Navigate, useParams } from "react-router-dom";
import { LogOut, Wrench } from "lucide-react";
import { useAuth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function OficinaPage() {
  const { slug } = useParams();
  const { me, loading, logout } = useAuth();

  if (loading) return <div className="p-8 text-muted-foreground">Carregando…</div>;
  if (!me) return <Navigate to="/" replace />;
  if (!me.approved && !me.isOwner) return <Navigate to="/pendente" replace />;

  const emp = me.employees.find((e) => e.workshopSlug === slug);
  const allowed = me.isAdmin || !!emp || me.roles.some((r) => r.workshopId && emp?.workshopId === r.workshopId);
  if (!allowed && !me.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-6 max-w-md">Você não tem acesso a esta mecânica.</Card>
      </div>
    );
  }

  const name = emp?.workshopName ?? slug;

  return (
    <div className="min-h-screen">
      <header className="border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <Wrench className="w-4 h-4 text-primary" /> {name}
        </div>
        <div className="flex items-center gap-2">
          {(me.isAdmin || me.isDonoMec) && (
            <Button asChild variant="outline" size="sm">
              <Link to="/admin">Admin</Link>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            <LogOut className="w-4 h-4" /> Sair
          </Button>
        </div>
      </header>
      <main className="max-w-3xl mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-bold">Área — {name}</h1>
        <p className="text-muted-foreground text-sm">
          Logado como {me.displayName || me.username}. Discord ID {me.discordId}.
        </p>
        <Card className="p-5 text-sm text-muted-foreground">
          OS, estoque, ponto e farm entram na próxima fase. O Discord desta oficina (guild e canais)
          é configurado em Admin → Mecânicas.
        </Card>
      </main>
    </div>
  );
}
