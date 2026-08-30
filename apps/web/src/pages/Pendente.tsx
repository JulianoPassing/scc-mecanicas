import { Link } from "react-router-dom";
import { AlertCircle, LogOut } from "lucide-react";
import { useAuth } from "@/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function PendentePage() {
  const { me, logout } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-6 space-y-4">
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
