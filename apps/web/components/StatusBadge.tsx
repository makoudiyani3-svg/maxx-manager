const STATUS_CONFIG: Record<
  string,
  { label: string; className: string; dot: string }
> = {
  captured: {
    label: "Capturé",
    className: "bg-white/5 text-[var(--text-muted)] border border-white/10",
    dot: "bg-[var(--text-faint)]",
  },
  enriching: {
    label: "Enrichissement",
    className: "bg-[rgba(94,184,255,0.12)] text-[var(--info)] border border-[rgba(94,184,255,0.25)]",
    dot: "bg-[var(--info)] animate-pulse",
  },
  ready: {
    label: "Prêt",
    className: "bg-[var(--accent-glow)] text-[var(--accent)] border border-[rgba(200,245,66,0.3)]",
    dot: "bg-[var(--accent)]",
  },
  publishing: {
    label: "Publication",
    className: "bg-[rgba(245,197,66,0.12)] text-[var(--warning)] border border-[rgba(245,197,66,0.25)]",
    dot: "bg-[var(--warning)] animate-pulse",
  },
  active: {
    label: "Actif",
    className: "bg-[rgba(94,224,154,0.12)] text-[var(--success)] border border-[rgba(94,224,154,0.25)]",
    dot: "bg-[var(--success)]",
  },
  error: {
    label: "Erreur",
    className: "bg-[rgba(255,107,107,0.12)] text-[var(--danger)] border border-[rgba(255,107,107,0.25)]",
    dot: "bg-[var(--danger)]",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.captured;
  return (
    <span className={`badge ${config.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

export const STATUS_FILTERS = [
  { value: "", label: "Tous", key: "all" },
  { value: "captured", label: "Capturés", key: "captured" },
  { value: "enriching", label: "En cours", key: "enriching" },
  { value: "ready", label: "Prêts", key: "ready" },
  { value: "active", label: "Actifs", key: "active" },
  { value: "error", label: "Erreurs", key: "error" },
];
