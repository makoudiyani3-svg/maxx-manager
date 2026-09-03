import type { Metadata } from "next";
import { Suspense } from "react";
import { Sora, DM_Sans, JetBrains_Mono, Geist } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/allowlist";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Maxx Manager — War Room",
  description: "Sourcing maxx.ca → enrichissement IA → Shopify",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let userEmail: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user && isEmailAllowed(user.email)) {
      userEmail = user.email ?? null;
    }
  } catch {
    userEmail = null;
  }

  return (
    <html
      lang="fr"
      className={cn("h-full", "antialiased", sora.variable, dmSans.variable, jetbrains.variable, "font-sans", geist.variable)}
    >
      <body className="min-h-full">
        <Suspense fallback={<div className="min-h-screen bg-[var(--bg)]" />}>
          <AppShell userEmail={userEmail}>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
