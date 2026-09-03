"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CaptureMaxxForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: url.trim() }),
      });
      const data = await res.json();
      if (res.status === 409 && data.productId) {
        setMsg("Déjà capturé — ouverture…");
        router.push(`/products/${data.productId}`);
        return;
      }
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Échec capture");
      setMsg("Capturé — enrichissement IA…");
      setUrl("");
      router.push(`/products/${data.productId}`);
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Erreur capture");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className={
        compact
          ? "flex flex-col gap-2"
          : "bento flex flex-col gap-2 p-4 sm:flex-row sm:items-end"
      }
    >
      <div className="min-w-0 flex-1">
        {!compact && <label className="field-label">Capturer un lot Maxx</label>}
        <input
          className="field-input w-full"
          type="url"
          required
          placeholder="https://maxx.ca/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
        />
      </div>
      <button
        type="submit"
        className="btn btn-primary w-full shrink-0 sm:w-auto"
        disabled={busy || !url.trim()}
      >
        {busy ? "Capture…" : "Capturer + IA"}
      </button>
      {msg && (
        <p className="basis-full text-xs text-[var(--text-muted)]">{msg}</p>
      )}
    </form>
  );
}
