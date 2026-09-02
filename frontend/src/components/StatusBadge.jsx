// Centralized status -> visual style mapping. Nothing else in the
// app should hard-code a status color — every place that needs to
// show a status renders this component instead.
const STATUS_STYLES = {
  SAVED: { label: "Saved", background: "#eef0f3", color: "#4b5563", border: "#dde1e6" },
  APPLIED: { label: "Applied", background: "#e8effe", color: "#2952c8", border: "#c9d9fb" },
  INTERVIEW: { label: "Interview", background: "#e6f6ec", color: "#1f8a4c", border: "#c3ecd2" },
  OFFER: { label: "Offer", background: "#fdf3d9", color: "#96700a", border: "#f7e3a3" },
  REJECTED: { label: "Rejected", background: "#fdecee", color: "#c22b3a", border: "#f3c3c9" },
};

// Any status not in the map above (a future value the frontend
// doesn't know about yet) falls back to this neutral style instead of
// rendering nothing or throwing.
const FALLBACK_STYLE = { label: null, background: "#eef0f3", color: "#4b5563", border: "#dde1e6" };

export default function StatusBadge({ status }) {
  const style = STATUS_STYLES[status] ?? FALLBACK_STYLE;
  const label = style.label ?? status ?? "Unknown";

  return (
    <span
      className="status-badge"
      style={{ backgroundColor: style.background, color: style.color, borderColor: style.border }}
    >
      {label}
    </span>
  );
}
