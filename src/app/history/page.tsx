import { desc } from "drizzle-orm";
import { db } from "@/server/db";
import { dataUpdates } from "@/server/db/schema";
import { listHealthChecks } from "@/server/healthCheck";
import { listSnapshots, storedSnapshotResult } from "@/server/snapshots";
import { netWorthDeltaLabel } from "@/shared/history";
import { CopyExportButton } from "../CopyExportButton";
import { PageShell, SectionHeading, SystemHeader, Tag } from "../ui";

export const dynamic = "force-dynamic";

function eur(value: string | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export default async function HistoryPage() {
  const [checks, updates, snapshotRows] = await Promise.all([
    listHealthChecks(36),
    db.select().from(dataUpdates).orderBy(desc(dataUpdates.createdAt)).limit(50),
    listSnapshots("strategic", 36),
  ]);

  return (
    <PageShell>
      <SystemHeader
        active="history"
        title="History"
        kicker="CFO / AUDIT TRAIL / APPEND ONLY"
        actions={<CopyExportButton />}
      />
      <div className="status-strip">
        <div className="status-cell"><div className="microlabel">Checks</div><div className="status-value ok">{checks.length} shown</div></div>
        <div className="status-cell"><div className="microlabel">Data updates</div><div className="status-value">{updates.length} shown</div></div>
        <div className="status-cell"><div className="microlabel">Snapshots</div><div className="status-value">{snapshotRows.length} shown</div></div>
        <div className="status-cell"><div className="microlabel">Last check</div><div className="status-value">{checks[0]?.createdAt.toISOString().slice(0, 10) ?? "—"}</div></div>
      </div>

      <SectionHeading action={<Tag kind="Judgment" />}>Monthly checks</SectionHeading>
      {checks.length === 0 ? <p className="notice mt-2">No checks yet.</p> : checks.map((check) => {
        const report = check.report as { headline?: string; observations?: string[] } | null;
        return (
          <article className={`check-panel mt-2 check-${check.verdict}`} key={check.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="microlabel">{check.createdAt.toISOString().slice(0, 10)} / {check.trigger} / {check.model ?? "deterministic"}</div>
              <span className={`status-chip ${check.verdict === "ok" ? "ok" : check.verdict === "watch" ? "warn" : "bad"}`}>{check.verdict}</span>
            </div>
            <p className="check-headline">{report?.headline ?? "Deterministic check completed."}</p>
            {report?.observations?.length ? <ul className="check-list">{report.observations.map((item) => <li key={item}>{item}</li>)}</ul> : null}
            {check.llmError && <p className="fine-print mt-2">AI note: {check.llmError}</p>}
          </article>
        );
      })}

      <SectionHeading action={<Tag kind="Verified" />}>Data updates</SectionHeading>
      <div className="table-shell mt-2">
        <table className="data-table">
          <thead><tr><th>Recorded</th><th>As of</th><th>Changes</th><th>Note</th></tr></thead>
          <tbody>
            {updates.length === 0 && <tr><td colSpan={4}>No batch updates yet. Older opening values remain in the record.</td></tr>}
            {updates.map((update) => {
              const changes = update.changes as { label?: string; value?: string }[];
              return <tr key={update.id}>
                <td className="mono">{update.createdAt.toISOString().slice(0, 10)}</td>
                <td className="mono">{update.asOf}</td>
                <td>
                  {changes.length === 0 ? (
                    "—"
                  ) : (
                    <ul className="change-list">
                      {changes.map((change, index) => (
                        <li key={`${change.label ?? "value"}-${index}`}>
                          <span>{change.label ?? "value"}</span>
                          <span className="mono">{change.value ?? "—"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td>{update.note ?? "—"}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>

      <SectionHeading action={<Tag kind="Calculated" />}>Strategic snapshots</SectionHeading>
      <div className="table-shell mt-2">
        <table className="data-table">
          <thead><tr><th>As of</th><th>Status</th><th className="num">Net worth</th><th className="num">Δ</th><th className="num">Liquid</th><th className="num">Safe / month</th></tr></thead>
          <tbody>
            {snapshotRows.map((row, index) => {
              const snapshot = storedSnapshotResult(row);
              const previous = snapshotRows[index + 1]
                ? storedSnapshotResult(snapshotRows[index + 1]).netWorth.value.totalEUR
                : null;
              const delta = netWorthDeltaLabel(snapshot.netWorth.value.totalEUR, previous);
              return <tr key={row.id}>
                <td className="mono">{snapshot.asOf}</td>
                <td>{snapshot.status.value.status.replaceAll("_", " ")}</td>
                <td className="num">{eur(snapshot.netWorth.value.totalEUR)}</td>
                <td className="num" style={{ color: "var(--ink-soft)" }}>{delta ?? "—"}</td>
                <td className="num">{eur(snapshot.netWorth.value.liquidEUR)}</td>
                <td className="num">{eur(snapshot.fire.value.safeMonthlySpendEUR)}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
