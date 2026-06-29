interface Props { value: number; size?: number; strokeWidth?: number }

export function ProgressRing({ value, size = 52, strokeWidth = 5 }: Props) {
  const r    = (size - strokeWidth) / 2
  const circ = 2 * Math.PI * r
  const fill = (Math.min(100, Math.max(0, value)) / 100) * circ
  const color = value >= 80 ? 'var(--success)' : value >= 60 ? 'var(--warning)' : 'var(--danger)'

  return (
    <div className="progress-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--surface-1)" strokeWidth={strokeWidth} />
        <circle
          cx={size/2} cy={size/2} r={r}
          fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={`${fill} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="ring-label">{value}</span>
    </div>
  )
}
