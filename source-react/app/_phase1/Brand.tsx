export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`} aria-label="REFLO">
      <img src="/reflo-logo.svg" alt="" />
      <div>
        <strong>REFLO</strong>
        {!compact && <span>Research, in one flow.</span>}
      </div>
    </div>
  );
}
