import { listActivity, loadOverview } from "@/server/overview";
import { formatDate, Masked } from "../ui";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const o = await loadOverview();
  const entries = await listActivity(o.names, 200);
  return (
    <main className="page">
      <h1>Activity</h1>
      <p className="lead">Everything recorded, newest first. Nothing is ever deleted.</p>
      <div className="card">
        {entries.length === 0 && <div className="row muted">Nothing yet.</div>}
        {entries.map((entry) => (
          <div key={entry.id} className="row" style={{ display: "block" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <strong style={{ fontWeight: 600 }}>
                <Masked text={entry.title} />
              </strong>
              <span className="muted small" style={{ whiteSpace: "nowrap" }}>
                {formatDate(entry.asOf)}
              </span>
            </div>
            {entry.lines.length > 0 && (
              <ul className="activity-lines">
                {entry.lines.map((line, index) => (
                  <li key={`${line.label}-${index}`}>
                    <span>{line.label}</span>
                    <span className="num">
                      <Masked text={line.value} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {entry.note && (
              <div className="row-sub">
                <Masked text={entry.note} />
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
