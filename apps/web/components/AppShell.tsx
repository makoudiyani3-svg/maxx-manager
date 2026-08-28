"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Pipeline", icon: "◈" },
  { href: "/?status=ready", label: "Prêts à publier", icon: "◎" },
  { href: "/?status=active", label: "Publiés", icon: "●" },
  { href: "/?status=error", label: "Erreurs", icon: "!" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isProduct = pathname.startsWith("/products/");

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-elevated)]/80 backdrop-blur-xl lg:flex">
        <div className="border-b border-[var(--border)] px-5 py-5">
          <Link href="/" className="group block">
            <div className="font-display text-lg font-bold tracking-tight">
              Maxx<span className="text-[var(--accent)]">.</span>Manager
            </div>
            <p className="mt-0.5 text-xs text-[var(--text-faint)]">
              Sourcing → Shopify
            </p>
          </Link>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3">
          <p className="px-3 pb-2 pt-1 text-[0.65rem] font-bold uppercase tracking-widest text-[var(--text-faint)]">
            Navigation
          </p>
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/" && !isProduct
                : false;
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

        <div className="border-t border-[var(--border)] p-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
            <p className="text-xs font-semibold text-[var(--text)]">Images fabricant</p>
            <p className="mt-1 text-[0.7rem] leading-relaxed text-[var(--text-faint)]">
              Les photos viennent du site officiel du fabricant, jamais de maxx.ca.
            </p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-xl lg:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <Link href="/" className="font-display text-base font-bold">
              Maxx<span className="text-[var(--accent)]">.</span>Manager
            </Link>
            <span className="text-xs text-[var(--text-faint)]">Pipeline</span>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
