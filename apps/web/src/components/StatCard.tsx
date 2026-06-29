interface Props { value: number | string; label: string; sub?: string }

export function StatCard({ value, label, sub }: Props) {
  return (
    <div className="card stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="text-sm text-muted">{sub}</div>}
    </div>
  )
}
