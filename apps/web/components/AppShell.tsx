"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/", label: "War Room", match: "home" },
  { href: "/?status=ready", label: "Prêts", match: "status=ready" },
  { href: "/?bid=published", label: "Publiés", match: "bid=published" },
  { href: "/?bid=won", label: "Won", match: "bid=won" },
];

function ShopifyHealthDot() {
  const [info, setInfo] = useState<{
    ok: boolean | null;
    name?: string;
  }>({ ok: null });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/shopify/health")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setInfo({
            ok: Boolean(data.connected),
            name: data.shopName,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setInfo({ ok: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
      <span
        className={`size-2 rounded-full ${
          info.ok === null
            ? "bg-[var(--text-faint)]"
            : info.ok
              ? "bg-[var(--success)]"
              : "bg-[var(--danger)]"
        }`}
      />
      <span className="hidden sm:inline">
        Shopify {info.ok === null ? "…" : info.ok ? info.name ?? "OK" : "off"}
      </span>
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

  const initials = userEmail
    ? userEmail
        .split("@")[0]
        .split(/[._-]/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("") || "?"
    : "U";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-bold text-white">
              M
            </span>
            <span className="font-display text-base font-bold tracking-tight">
              Maxx<span className="text-[var(--text-faint)]">.</span>Manager
            </span>
          </Link>

          <nav className="hidden items-center rounded-full bg-white/80 p-1 shadow-[var(--shadow-card)] md:flex">
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
              } else if (item.match.startsWith("alert=")) {
                active =
                  pathname === "/" &&
                  searchParams.get("alert") === item.match.slice(6);
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-white text-[var(--text)] shadow-sm"
                      : "text-[var(--text-muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-3">
            <ShopifyHealthDot />
            {userEmail && (
              <div className="flex items-center gap-2 rounded-full bg-white py-1 pl-1 pr-3 shadow-[var(--shadow-card)]">
                <span className="flex size-8 items-center justify-center rounded-full bg-[var(--bg)] text-xs font-bold">
                  {initials}
                </span>
                <div className="hidden min-w-0 sm:block">
                  <p className="truncate text-xs font-semibold leading-tight">
                    {userEmail.split("@")[0]}
                  </p>
                  <form action="/auth/signout" method="post">
                    <button
                      type="submit"
                      className="text-[0.65rem] text-[var(--text-faint)] hover:text-[var(--danger)]"
                    >
                      Déconnexion
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-4 pb-3 md:hidden">
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
            } else if (item.match.startsWith("alert=")) {
              active =
                pathname === "/" &&
                searchParams.get("alert") === item.match.slice(6);
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                  active
                    ? "bg-[var(--accent)] text-white"
                    : "bg-white text-[var(--text-muted)]"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {children}
      </main>
    </div>
  );
}
