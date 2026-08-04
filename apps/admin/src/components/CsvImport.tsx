import { useRef } from "react";

/** Simple CSV parser. Returns headers (lowercased, trimmed) and data rows as key→value maps. */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  // Parse a CSV line respecting double-quoted fields (RFC 4180 subset)
  function parseLine(line: string): string[] {
    const result: string[] = [];
    let inQuote = false;
    let current = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === "," && !inQuote) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  const headers = parseLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const rows = lines.slice(1).map((line) => {
    const values = parseLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });

  return { headers, rows };
}

/** Escape a single CSV cell value (quotes if it contains comma, quote, or newline). */
function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Build a CSV string from headers + rows. */
export function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ];
  return lines.join("\r\n");
}

/** Trigger a browser download of a text file. */
function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface CsvTemplate {
  /** Download filename, e.g. "residents-template.csv" */
  filename: string;
  /** Column header names — must match what the import API expects */
  headers: string[];
  /** One example row of values, same order as headers */
  example: string[];
}

interface CsvImportButtonProps {
  onFile: (file: File) => void;
  loading?: boolean;
  label?: string;
  /** When provided, renders a "⬇ Template" link next to the import button */
  template?: CsvTemplate;
}

/** Import button + optional template download link. */
export function CsvImportButton({ onFile, loading, label = "Import CSV", template }: CsvImportButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = "";
  }

  function handleTemplate() {
    if (!template) return;
    const csv = buildCsv(template.headers, [template.example]);
    downloadText(template.filename, csv);
  }

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleChange}
      />
      <button
        type="button"
        disabled={loading}
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1.5 rounded-xl border border-brand-line px-4 py-2 text-sm font-semibold text-brand-ink transition-colors hover:bg-brand-primarySoft disabled:opacity-50"
      >
        {/* Upload arrow icon */}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        {loading ? "Importing…" : label}
      </button>

      {template && (
        <button
          type="button"
          onClick={handleTemplate}
          title={`Download ${template.filename}`}
          className="flex items-center gap-1 rounded-xl border border-transparent px-2 py-2 text-xs font-semibold text-brand-primary transition-colors hover:border-brand-primary/20 hover:bg-brand-primarySoft"
        >
          {/* Download arrow icon */}
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Template
        </button>
      )}
    </div>
  );
}
