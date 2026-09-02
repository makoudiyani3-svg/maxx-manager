"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: signError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (signError) {
        setError(
          signError.message === "Invalid login credentials"
            ? "Email ou mot de passe incorrect"
            : signError.message
        );
        return;
      }

      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de connexion");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="field-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field-input"
          placeholder="toi@unit411.com"
        />
      </div>
      <div>
        <label className="field-label" htmlFor="password">
          Mot de passe
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field-input"
        />
      </div>

      {error && (
        <p className="rounded-xl border border-[rgba(255,107,107,0.3)] bg-[rgba(255,107,107,0.1)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}

      <button type="submit" disabled={loading} className="btn btn-primary w-full">
        {loading ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}
