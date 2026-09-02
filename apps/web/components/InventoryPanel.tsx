"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const TEAM = [
  "yanimakoudi4@gmail.com",
  "makoudilyes6@gmail.com",
  "djadoun26aghiles@gmail.com",
];

const REASONS = [
  { value: "adjust", label: "Ajustement" },
  { value: "receive", label: "Réception" },
  { value: "return", label: "Retour" },
  { value: "damage", label: "Dommage" },
  { value: "sale", label: "Vente manuelle" },
  { value: "other", label: "Autre" },
] as const;

export function InventoryPanel({
  productId,
  stockQty,
  lowStockThreshold,
  assignedTo,
  internalNotes,
  actualCostLot,
  actualCostUnit,
  costPrice,
  suggestedPrice,
  movements,
}: {
  productId: string;
  stockQty: number;
  lowStockThreshold: number;
  assignedTo: string | null;
  internalNotes: string | null;
  actualCostLot: number | null;
  actualCostUnit: number | null;
  costPrice: number | null;
  suggestedPrice: number | null;
  movements: Array<{
    id: string;
    delta: number;
    quantityAfter: number;
    reason: string;
    note: string | null;
    createdBy: string | null;
    createdAt: string;
  }>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"set" | "delta">("set");
  const [qty, setQty] = useState(String(stockQty));
  const [delta, setDelta] = useState("0");
  const [reason, setReason] = useState<(typeof REASONS)[number]["value"]>("adjust");
  const [note, setNote] = useState("");
  const [threshold, setThreshold] = useState(String(lowStockThreshold));
  const [notes, setNotes] = useState(internalNotes ?? "");
  const [assignee, setAssignee] = useState(assignedTo ?? "");
  const [winCost, setWinCost] = useState(
    actualCostLot != null ? String(actualCostLot) : ""
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setQty(String(stockQty));
  }, [stockQty]);

  useEffect(() => {
    setThreshold(String(lowStockThreshold));
  }, [lowStockThreshold]);

  const unitCost = actualCostUnit ?? costPrice;
  const margin =
    suggestedPrice != null && unitCost != null && suggestedPrice > 0
      ? Math.round(((suggestedPrice - unitCost) / suggestedPrice) * 100)
      : null;

  async function saveStock() {
    setBusy(true);
    setMsg(null);
    try {
      const body =
        mode === "set"
          ? {
              quantity: parseInt(qty, 10),
              reason,
              note: note || undefined,
              syncShopify: true,
            }
          : {
              delta: parseInt(delta, 10),
              reason,
              note: note || undefined,
              syncShopify: true,
            };

      if (mode === "set" && Number.isNaN(body.quantity as number)) {
        throw new Error("Quantité invalide");
      }
      if (mode === "delta" && Number.isNaN(body.delta as number)) {
        throw new Error("Delta invalide");
      }

      const res = await fetch(`/api/products/${productId}/inventory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Échec stock");
      setMsg(
        data.shopifySync?.ok === false
          ? `Stock local OK · Shopify: ${data.shopifySync.error}`
          : `Stock → ${data.stockQty}`
      );
      setNote("");
      setDelta("0");
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function saveOps() {
    setBusy(true);
    setMsg(null);
    try {
      const thresholdNum = parseInt(threshold, 10);
      const res = await fetch(`/api/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignedTo: assignee || null,
          internalNotes: notes || null,
          actualCostLot: winCost === "" ? null : parseFloat(winCost),
          lowStockThreshold: Number.isNaN(thresholdNum) ? undefined : thresholdNum,
          syncShopifyContent: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Échec");
      setMsg(
        data.shopifyContentSync?.ok === false
          ? `Ops OK · Shopify: ${data.shopifyContentSync.error}`
          : "Ops sauvegardés (+ sync Shopify)"
      );
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel panel-glow space-y-4 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="field-label">Inventaire (pool unique)</p>
          <p className="stat-value text-[var(--accent)]">{stockQty}</p>
          {stockQty <= lowStockThreshold && (
            <p className="mt-1 text-xs text-[var(--danger)]">Alerte stock bas</p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex rounded-lg border border-[var(--border)] p-0.5">
            <button
              type="button"
              className={`rounded-md px-2 py-1 text-xs ${
                mode === "set" ? "bg-[var(--bg-hover)] text-[var(--text)]" : "text-[var(--text-muted)]"
              }`}
              onClick={() => setMode("set")}
            >
              Définir
            </button>
            <button
              type="button"
              className={`rounded-md px-2 py-1 text-xs ${
                mode === "delta"
                  ? "bg-[var(--bg-hover)] text-[var(--text)]"
                  : "text-[var(--text-muted)]"
              }`}
              onClick={() => setMode("delta")}
            >
              +/-
            </button>
          </div>
          {mode === "set" ? (
            <div>
              <label className="field-label">Qty</label>
              <input
                className="field-input w-24"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                type="number"
                min={0}
              />
            </div>
          ) : (
            <div>
              <label className="field-label">Delta</label>
              <input
                className="field-input w-24"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                type="number"
              />
            </div>
          )}
          <div>
            <label className="field-label">Raison</label>
            <select
              className="field-input"
              value={reason}
              onChange={(e) =>
                setReason(e.target.value as (typeof REASONS)[number]["value"])
              }
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void saveStock()}
          >
            Appliquer
          </button>
        </div>
      </div>

      <div>
        <label className="field-label">Note mouvement</label>
        <input
          className="field-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex: carton abîmé, comptage rayon…"
          maxLength={500}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[0.65rem] text-[var(--text-faint)]">Coût unitaire</p>
          <p className="font-semibold">
            {unitCost != null ? `${Number(unitCost).toFixed(2)} $` : "—"}
          </p>
        </div>
        <div>
          <p className="text-[0.65rem] text-[var(--text-faint)]">Marge réelle</p>
          <p
            className={`font-semibold ${
              margin != null && margin < 50
                ? "text-[var(--danger)]"
                : "text-[var(--success)]"
            }`}
          >
            {margin != null ? `${margin}%` : "—"}
          </p>
        </div>
        <div>
          <label className="field-label">Coût win lot ($)</label>
          <input
            className="field-input"
            value={winCost}
            onChange={(e) => setWinCost(e.target.value)}
            type="number"
            step="0.01"
            min={0}
            placeholder="Enchère gagnée"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="field-label">Seuil stock bas</label>
          <input
            className="field-input"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            type="number"
            min={0}
          />
        </div>
        <div>
          <label className="field-label">Assigné à</label>
          <select
            className="field-input"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">—</option>
            {TEAM.map((email) => (
              <option key={email} value={email}>
                {email}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">Notes internes</label>
          <textarea
            className="field-input min-h-[80px]"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Qualité, défauts, suivi…"
          />
        </div>
      </div>

      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy}
        onClick={() => void saveOps()}
      >
        Sauver ops + sync Shopify
      </button>

      {msg && <p className="text-sm text-[var(--text-muted)]">{msg}</p>}

      <div>
        <p className="field-label">Mouvements</p>
        {movements.length === 0 ? (
          <p className="text-sm text-[var(--text-faint)]">Aucun mouvement</p>
        ) : (
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-[var(--text-muted)]">
            {movements.map((m) => (
              <li
                key={m.id}
                className="flex justify-between gap-2 border-b border-[var(--border)] py-1"
              >
                <span>
                  {m.reason} {m.delta >= 0 ? `+${m.delta}` : m.delta} → {m.quantityAfter}
                  {m.note ? ` · ${m.note}` : ""}
                </span>
                <span className="shrink-0 text-[var(--text-faint)]">
                  {new Date(m.createdAt).toLocaleString("fr-CA", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
