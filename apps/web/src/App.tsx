import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/auth";
import { HomePage } from "@/pages/Home";
import { PendentePage } from "@/pages/Pendente";
import { OficinaPage } from "@/pages/Oficina";
import { AdminPage } from "@/pages/Admin";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/pendente" element={<Gate><PendentePage /></Gate>} />
      <Route path="/oficina/:slug" element={<Gate><OficinaPage /></Gate>} />
      <Route path="/admin" element={<Gate><AdminPage /></Gate>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <div className="p-8 text-muted-foreground">Carregando…</div>;
  if (!me) return <Navigate to="/" replace />;
  return children;
}
