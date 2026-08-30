import { Link } from "react-router-dom";
import { AlertCircle, LogOut } from "lucide-react";
import { useAuth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function PendentePage() {
  const { me, logout } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-96 h-96 bg-primary/15 blur-3xl glow-orb pointer-events-none" />
      <Card className="max-w-md w-full p-7 space-y-5 glass shop-ring relative z-10 anim-up">
        <img src="/favicon.png" alt="SCC" className="w-12 h-12 rounded-xl" />
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div>
            <h1 className="font-semibold text-lg">Aguardando liberação</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Olá, <strong>{me?.username}</strong>. Seu cadastro foi recebido. Um admin da mecânica precisa
              liberar o acesso.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/">Início</Link>
          </Button>
          <Button variant="outline" onClick={() => void logout()}>
            <LogOut className="w-4 h-4" /> Sair
          </Button>
        </div>
      </Card>
    </div>
  );
}
