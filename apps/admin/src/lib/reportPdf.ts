import type { DashboardOverview } from "@patrol-log/shared";

/** Build and download a real PDF file (no popup / blank tab). */
export function downloadPatrolReportPdf(data: DashboardOverview): void {
  const sectorLabel = data.sector?.code || data.sector?.name || "All sectors";
  const periodLabel =
    data.period === "month"
      ? "This month"
      : data.period === "today"
        ? "Today"
        : data.period === "custom"
          ? "Custom range"
          : data.period;
  const fromLabel = new Date(data.periodStart).toLocaleDateString();
  const toLabel = new Date(data.periodEnd).toLocaleDateString();
  const typeLabel = data.patrolType
    ? data.patrolType.replace(/_/g, " ")
    : "All types";

  const lines: PdfLine[] = [
    { text: "Patrol report", size: 18, bold: true },
    { text: `${sectorLabel}  |  ${periodLabel}  |  ${fromLabel} – ${toLabel}  |  ${typeLabel}`, size: 10, color: gray },
    { text: "", size: 10 },
    {
      text: `Distance: ${data.kpis.totalKm.toLocaleString()} km    Hours: ${data.kpis.totalHours}    Completed: ${data.kpis.completedPatrols}    Members: ${data.kpis.uniqueMembers}`,
      size: 11,
    },
    { text: "", size: 10 },
    {
      text: pad("Call sign", 12) + pad("Name", 28) + padRight("Patrols", 10) + padRight("Hours", 10) + padRight("Km", 10),
      size: 9,
      bold: true,
      color: gray,
    },
    { text: "-".repeat(70), size: 9, color: gray },
  ];

  if (data.members.length === 0) {
    lines.push({ text: "No completed patrols in this period", size: 10, color: gray });
  } else {
    for (const m of data.members) {
      lines.push({
        text:
          pad(m.callSign, 12) +
          pad(m.name, 28) +
          padRight(String(m.patrolCount), 10) +
          padRight(String(m.hours), 10) +
          padRight(String(m.km), 10),
        size: 10,
      });
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const safeSector = sectorLabel.replace(/[^\w.-]+/g, "_").slice(0, 40);
  downloadBlob(`patrol-report-${safeSector}-${stamp}.pdf`, buildPdf(lines));
}

type PdfLine = { text: string; size: number; bold?: boolean; color?: [number, number, number] };
const gray: [number, number, number] = [0.4, 0.4, 0.4];

function pad(s: string, n: number): string {
  const t = s.length > n ? `${s.slice(0, n - 3)}...` : s;
  return t + " ".repeat(Math.max(0, n - t.length));
}

function padRight(s: string, n: number): string {
  return " ".repeat(Math.max(0, n - s.length)) + s;
}

function downloadBlob(filename: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

function buildPdf(lines: PdfLine[]): Uint8Array {
  const pageWidth = 595;
  const pageHeight = 842;
  const marginX = 48;
  const marginTop = 56;
  const marginBottom = 48;
  const lineGap = 4;

  const pageStreams: string[] = [];
  let y = pageHeight - marginTop;
  let stream = "BT\n";

  function flushPage() {
    stream += "ET\n";
    pageStreams.push(stream);
    stream = "BT\n";
    y = pageHeight - marginTop;
  }

  for (const line of lines) {
    const leading = line.size + lineGap;
    if (y - leading < marginBottom) flushPage();
    if (!line.text) {
      y -= leading * 0.6;
      continue;
    }
    const font = line.bold ? "F2" : "F1";
    const [r, g, b] = line.color ?? [0, 0, 0];
    stream += `/${font} ${line.size} Tf\n`;
    stream += `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg\n`;
    stream += `1 0 0 1 ${marginX} ${y.toFixed(2)} Tm\n`;
    stream += `(${escapePdf(line.text)}) Tj\n`;
    y -= leading;
  }
  flushPage();

  return assemblePdf(pageStreams, pageWidth, pageHeight);
}

function assemblePdf(pageStreams: string[], pageWidth: number, pageHeight: number): Uint8Array {
  const parts: string[] = [];
  const offsets: number[] = [0];
  let pos = 0;

  function write(s: string) {
    parts.push(s);
    pos += byteLength(s);
  }

  function startObj(id: number) {
    offsets[id] = pos;
    write(`${id} 0 obj\n`);
  }

  function endObj() {
    write("endobj\n");
  }

  write("%PDF-1.4\n");

  const catalogId = 1;
  const pagesObjId = 2;
  const fontRegularId = 3;
  const fontBoldId = 4;
  const firstContentId = 5;
  const pageCount = pageStreams.length;
  const pageIds = pageStreams.map((_, i) => firstContentId + pageCount + i);

  startObj(catalogId);
  write(`<< /Type /Catalog /Pages ${pagesObjId} 0 R >>\n`);
  endObj();

  startObj(pagesObjId);
  write(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>\n`);
  endObj();

  startObj(fontRegularId);
  write("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\n");
  endObj();

  startObj(fontBoldId);
  write("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\n");
  endObj();

  for (let i = 0; i < pageCount; i++) {
    const contentId = firstContentId + i;
    const stream = pageStreams[i];
    startObj(contentId);
    write(`<< /Length ${byteLength(stream)} >>\nstream\n${stream}endstream\n`);
    endObj();
  }

  for (let i = 0; i < pageCount; i++) {
    const contentId = firstContentId + i;
    const pageId = pageIds[i];
    startObj(pageId);
    write(
      `<< /Type /Page /Parent ${pagesObjId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
        `/Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> >>\n`,
    );
    endObj();
  }

  const xrefPos = pos;
  const maxId = pageIds[pageIds.length - 1];
  write(`xref\n0 ${maxId + 1}\n`);
  write("0000000000 65535 f \n");
  for (let id = 1; id <= maxId; id++) {
    write(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
  }
  write(`trailer\n<< /Size ${maxId + 1} /Root ${catalogId} 0 R >>\n`);
  write(`startxref\n${xrefPos}\n%%EOF\n`);

  return new TextEncoder().encode(parts.join(""));
}

function escapePdf(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\\" || ch === "(" || ch === ")") out += `\\${ch}`;
    else if (code >= 32 && code <= 126) out += ch;
    else if (code >= 160 && code <= 255) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += "?";
  }
  return out;
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}
