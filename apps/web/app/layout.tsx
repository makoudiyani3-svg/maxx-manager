import type { Metadata } from "next";
import { Suspense } from "react";
import { Sora, DM_Sans, JetBrains_Mono } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { createClient } from "@/lib/supabase/server";
import { isEmailAllowed } from "@/lib/auth/allowlist";
import "./globals.css";

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
      className={`${sora.variable} ${dmSans.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Suspense fallback={<div className="min-h-screen bg-[var(--bg)]" />}>
          <AppShell userEmail={userEmail}>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
