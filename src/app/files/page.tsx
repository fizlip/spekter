import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { FileText } from "lucide-react";
import { readKnowledge } from "@/core/knowledge/markdown-folder";

function preview(content: string) {
  const firstLine = content.split("\n").find((line) => line.trim()) ?? "";
  return firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine;
}

async function KnowledgeFiles() {
  await connection();

  let notes;
  try {
    notes = await readKnowledge();
  } catch (error) {
    return (
      <p className="text-sm text-red-600">
        {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }

  if (notes.length === 0) {
    return <p className="text-sm text-slate-400">No knowledge files found.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs text-black">
          <th className="py-2 pr-4 font-medium">File</th>
          <th className="py-2 font-medium">Preview</th>
        </tr>
      </thead>
      <tbody>
        {notes.map((note) => (
          <tr key={note.path} className="border-t border-slate-100">
            <td className="whitespace-nowrap py-2 pr-4">
              <span className="flex items-center gap-2 font-mono text-xs">
                <FileText size={14} className="shrink-0" />
                {note.path}
              </span>
            </td>
            <td className="py-2 text-black">{preview(note.content)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function FilesPage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6 bg-chat">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-base font-semibold">Knowledge files</h1>
      </div>
      <Suspense fallback={<p className="text-sm text-slate-400">Loading…</p>}>
        <KnowledgeFiles />
      </Suspense>
    </div>
  );
}
