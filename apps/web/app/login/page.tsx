import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="panel panel-glow w-full max-w-md space-y-6 p-6 sm:p-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--text-faint)]">
            Accès UNIT411
          </p>
          <h1 className="font-display mt-1 text-3xl font-bold tracking-tight">
            Maxx<span className="text-[var(--accent)]">.</span>Manager
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Compte réservé à l&apos;équipe (3 utilisateurs autorisés).
          </p>
        </div>
        <Suspense fallback={<p className="text-sm text-[var(--text-faint)]">Chargement…</p>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
