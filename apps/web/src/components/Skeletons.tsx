export function SkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="skeleton-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-card">
          <div className="skeleton skeleton-img" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
          <div className="skeleton skeleton-btn" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonPdp() {
  return (
    <div className="skeleton-pdp" aria-hidden="true">
      <div className="skeleton skeleton-img" style={{ borderRadius: '12px' }} />
      <div>
        <div className="skeleton skeleton-line" style={{ height: '2rem', marginLeft: 0, marginRight: 0 }} />
        <div className="skeleton skeleton-line short" style={{ height: '1.6rem', marginLeft: 0 }} />
        <div className="skeleton skeleton-btn" style={{ marginLeft: 0, marginRight: 0, maxWidth: '280px' }} />
        <div className="skeleton skeleton-line" style={{ marginLeft: 0, marginRight: 0 }} />
        <div className="skeleton skeleton-line" style={{ marginLeft: 0, marginRight: 0 }} />
      </div>
    </div>
  );
}
