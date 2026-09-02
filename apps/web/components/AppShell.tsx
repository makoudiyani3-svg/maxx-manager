"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/", label: "War Room", icon: "◈", match: "home" },
  { href: "/?bid=watching", label: "Watching", icon: "○", match: "bid=watching" },
  { href: "/?bid=capped", label: "Capped", icon: "◎", match: "bid=capped" },
  { href: "/?status=ready", label: "Prêts à publier", icon: "◆", match: "status=ready" },
  { href: "/?bid=published", label: "Publiés", icon: "●", match: "bid=published" },
  { href: "/?bid=won", label: "Won", icon: "✓", match: "bid=won" },
  { href: "/?bid=lost", label: "Lost", icon: "×", match: "bid=lost" },
  { href: "/?status=error", label: "Erreurs", icon: "!", match: "status=error" },
];

function ShopifyHealthDot() {
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/shopify/health")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setOk(Boolean(data.connected));
      })
      .catch(() => {
        if (!cancelled) setOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex items-center gap-2 text-[0.7rem] text-[var(--text-faint)]">
      <span
        className={`h-2 w-2 rounded-full ${
          ok === null
            ? "bg-[var(--text-faint)]"
            : ok
              ? "bg-[var(--success)] shadow-[0_0_8px_var(--success)]"
              : "bg-[var(--danger)]"
        }`}
      />
      Shopify {ok === null ? "…" : ok ? "OK" : "off"}
    </div>
  );
}

export function AppShell({
  children,
  userEmail,
}: {
  children: React.ReactNode;
  userEmail?: string | null;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isProduct = pathname.startsWith("/products/");
  const isLogin = pathname.startsWith("/login");
  const query = searchParams.toString();

  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-elevated)]/80 backdrop-blur-xl lg:flex">
        <div className="border-b border-[var(--border)] px-5 py-5">
          <Link href="/" className="group block">
            <div className="font-display text-lg font-bold tracking-tight">
              Maxx<span className="text-[var(--accent)]">.</span>Manager
            </div>
            <p className="mt-0.5 text-xs text-[var(--text-faint)]">
              War Room · UNIT411
            </p>
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3">
          <p className="px-3 pb-2 pt-1 text-[0.65rem] font-bold uppercase tracking-widest text-[var(--text-faint)]">
            Navigation
          </p>
          {NAV.map((item) => {
            let active = false;
            if (item.match === "home") {
              active = pathname === "/" && !isProduct && !query;
            } else if (item.match.startsWith("bid=")) {
              active =
                pathname === "/" &&
                searchParams.get("bid") === item.match.slice(4);
            } else if (item.match.startsWith("status=")) {
              active =
                pathname === "/" &&
                searchParams.get("status") === item.match.slice(7);
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-[var(--accent-glow)] text-[var(--accent)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
                }`}
              >
                <span className="w-4 text-center opacity-70">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-[var(--border)] p-4">
          <ShopifyHealthDot />
          {userEmail && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
              <p className="truncate text-[0.7rem] text-[var(--text-muted)]">{userEmail}</p>
              <form action="/auth/signout" method="post" className="mt-2">
                <button
                  type="submit"
                  className="text-[0.7rem] font-medium text-[var(--danger)] hover:underline"
                >
                  Déconnexion
                </button>
              </form>
            </div>
          )}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
            <p className="text-xs font-semibold text-[var(--text)]">Inventaire</p>
            <p className="mt-1 text-[0.7rem] leading-relaxed text-[var(--text-faint)]">
              Pool unique · importer catalogue Shopify · sync ventes.
            </p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-xl lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="font-display text-base font-bold">
              Maxx<span className="text-[var(--accent)]">.</span>Manager
            </Link>
            <div className="flex items-center gap-3">
              <ShopifyHealthDot />
              {userEmail && (
                <form action="/auth/signout" method="post">
                  <button type="submit" className="text-xs text-[var(--danger)]">
                    Out
                  </button>
                </form>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
