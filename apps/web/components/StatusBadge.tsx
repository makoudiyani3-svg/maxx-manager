const STATUS_CONFIG: Record<
  string,
  { label: string; className: string; dot: string }
> = {
  captured: {
    label: "Capturé",
    className: "bg-white/90 text-[var(--text-muted)] border border-[var(--border)] backdrop-blur",
    dot: "bg-[var(--text-faint)]",
  },
  enriching: {
    label: "Enrichissement",
    className: "bg-white/90 text-[var(--text)] border border-[var(--border)] backdrop-blur",
    dot: "bg-[var(--text)] animate-pulse",
  },
  ready: {
    label: "Prêt",
    className: "bg-[var(--accent)] text-white border border-transparent",
    dot: "bg-white",
  },
  publishing: {
    label: "Publication",
    className: "bg-white/90 text-[var(--text)] border border-[var(--border)] backdrop-blur",
    dot: "bg-[var(--text)] animate-pulse",
  },
  active: {
    label: "Actif",
    className: "bg-white/90 text-[var(--success)] border border-[var(--border)] backdrop-blur",
    dot: "bg-[var(--success)]",
  },
  error: {
    label: "Erreur",
    className: "bg-white/90 text-[var(--danger)] border border-[rgba(229,72,77,0.3)] backdrop-blur",
    dot: "bg-[var(--danger)]",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.captured;
  return (
    <span className={`badge ${config.className}`}>
      <span className={`size-1.5 rounded-full ${config.dot}`} />
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
