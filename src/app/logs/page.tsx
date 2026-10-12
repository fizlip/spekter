import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { readRequestLog } from "@/core/instrumentation/request-log";

const outcomeColor = {
  reply: "text-emerald-600",
  error: "text-red-600",
  aborted: "text-amber-600",
} as const;

async function LogEntries() {
  await connection();
  const entries = (await readRequestLog()).reverse();

  if (entries.length === 0) {
    return <p className="text-sm text-slate-400">No requests logged yet.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs text-slate-400">
          <th className="py-2 pr-4 font-medium">Time</th>
          <th className="py-2 pr-4 font-medium">Endpoint</th>
          <th className="py-2 pr-4 font-medium">Model</th>
          <th className="py-2 pr-4 font-medium">Outcome</th>
          <th className="py-2 pr-4 font-medium">Duration</th>
          <th className="py-2 font-medium">Error</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, index) => (
          <tr key={index} className="border-t border-slate-100">
            <td className="whitespace-nowrap py-2 pr-4 text-slate-500">
              {new Date(entry.timestamp).toLocaleString()}
            </td>
            <td className="py-2 pr-4 font-mono text-xs">{entry.endpoint}</td>
            <td className="py-2 pr-4 text-slate-500">{entry.model ?? "—"}</td>
            <td className={`py-2 pr-4 font-medium ${outcomeColor[entry.outcome]}`}>
              {entry.outcome}
            </td>
            <td className="py-2 pr-4 text-slate-500">{entry.durationMs}ms</td>
            <td className="py-2 text-slate-400">{entry.errorCode ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function LogsPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6 bg-chat">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href="/"
          className="rounded-md px-2 py-1 text-sm text-slate-500 transition-colors hover:bg-slate-100"
        >
          ← Back
        </Link>
        <h1 className="text-base font-semibold">Request logs</h1>
      </div>
      <Suspense fallback={<p className="text-sm text-slate-400">Loading…</p>}>
        <LogEntries />
      </Suspense>
    </div>
  );
}
