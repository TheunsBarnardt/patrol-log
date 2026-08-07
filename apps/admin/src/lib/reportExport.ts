import { parseSqliteUtc, type PatrolDetailReport, type PatrolSummaryReport, type PatrolType } from "@patrol-log/shared";

const TYPE_LABELS: Record<PatrolType, string> = {
  foot: "Foot",
  vehicle: "Vehicle",
  static: "Static",
  sector_monitoring: "Sector monitoring",
  ops: "OPS",
  responding: "Responding",
};

export function patrolTypeLabel(type: PatrolType | null | undefined): string {
  if (!type) return "All types";
  return TYPE_LABELS[type] ?? type;
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ];
  return lines.join("\r\n");
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadText(filename: string, content: string, mime: string) {
  downloadBlob(filename, new Blob([content], { type: mime }));
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDisplayTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = parseSqliteUtc(value);
  if (!d) return value;
  return d.toLocaleString();
}

function vehicleLabel(reg: string | null, desc: string | null): string {
  if (reg && desc) return `${reg} (${desc})`;
  return reg || desc || "";
}

function callSignName(callSign: string, name: string): string {
  return `${callSign} / ${name}`;
}

/** SpreadsheetML workbook Excel opens as .xls (no dependency). */
function buildSpreadsheetMl(sheets: { name: string; headers: string[]; rows: string[][] }[]): string {
  const worksheets = sheets
    .map((sheet) => {
      const headerRow = `<Row>${sheet.headers
        .map((h) => `<Cell><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`)
        .join("")}</Row>`;
      const dataRows = sheet.rows
        .map(
          (row) =>
            `<Row>${row
              .map((cell) => {
                const num = cell !== "" && /^-?\d+(\.\d+)?$/.test(cell);
                return `<Cell><Data ss:Type="${num ? "Number" : "String"}">${xmlEscape(cell)}</Data></Cell>`;
              })
              .join("")}</Row>`,
        )
        .join("");
      return `<Worksheet ss:Name="${xmlEscape(sheet.name)}"><Table>${headerRow}${dataRows}</Table></Worksheet>`;
    })
    .join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${worksheets}
</Workbook>`;
}

function stamp(from: string, to: string): string {
  return `${from}_to_${to}`;
}

function roleLabel(role: "primary" | "joined" | undefined): string {
  return role === "joined" ? "Passenger" : "Primary";
}

export function downloadDetailCsv(report: PatrolDetailReport) {
  const headers = [
    "Call Sign / Name",
    "Role",
    "Sector",
    "Patrol Type",
    "Commenced At",
    "Stood Down At",
    "Duration Time",
    "Distance KM",
    "Vehicle",
  ];
  const rows = report.rows.map((r) => [
    callSignName(r.callSign, r.name),
    roleLabel(r.role),
    r.sector,
    patrolTypeLabel(r.patrolType),
    formatDisplayTime(r.commencedAt),
    formatDisplayTime(r.stoodDownAt),
    r.durationLabel,
    String(r.distanceKm),
    vehicleLabel(r.vehicleRegistration, r.vehicleDescription),
  ]);
  downloadText(
    `patrol-detail-${stamp(report.from, report.to)}.csv`,
    buildCsv(headers, rows),
    "text/csv;charset=utf-8;",
  );
}

export function downloadDetailExcel(report: PatrolDetailReport) {
  const headers = [
    "Call Sign / Name",
    "Role",
    "Sector",
    "Patrol Type",
    "Commenced At",
    "Stood Down At",
    "Duration Time",
    "Distance KM",
    "Vehicle",
  ];
  const rows = report.rows.map((r) => [
    callSignName(r.callSign, r.name),
    roleLabel(r.role),
    r.sector,
    patrolTypeLabel(r.patrolType),
    formatDisplayTime(r.commencedAt),
    formatDisplayTime(r.stoodDownAt),
    r.durationLabel,
    String(r.distanceKm),
    vehicleLabel(r.vehicleRegistration, r.vehicleDescription),
  ]);
  const xml = buildSpreadsheetMl([{ name: "Detail", headers, rows }]);
  downloadText(
    `patrol-detail-${stamp(report.from, report.to)}.xls`,
    xml,
    "application/vnd.ms-excel;charset=utf-8;",
  );
}

export function downloadSummaryCsv(report: PatrolSummaryReport) {
  const sections: string[] = [];

  sections.push("All users");
  sections.push(buildCsv(
    ["Callsign / Name", "Total KM", "Total Hours"],
    report.members.map((m) => [callSignName(m.callSign, m.name), String(m.totalKm), String(m.totalHours)]),
  ));
  sections.push("");
  sections.push("Top 10 Hours");
  sections.push(buildCsv(
    ["Callsign / Name", "Total Hours"],
    report.topHours.map((m) => [callSignName(m.callSign, m.name), String(m.totalHours)]),
  ));
  sections.push("");
  sections.push("Top 10 KM");
  sections.push(buildCsv(
    ["Callsign / Name", "Total KM"],
    report.topKm.map((m) => [callSignName(m.callSign, m.name), String(m.totalKm)]),
  ));

  downloadText(
    `patrol-summary-${stamp(report.from, report.to)}.csv`,
    sections.join("\r\n"),
    "text/csv;charset=utf-8;",
  );
}

export function downloadSummaryExcel(report: PatrolSummaryReport) {
  const xml = buildSpreadsheetMl([
    {
      name: "All users",
      headers: ["Callsign / Name", "Total KM", "Total Hours"],
      rows: report.members.map((m) => [
        callSignName(m.callSign, m.name),
        String(m.totalKm),
        String(m.totalHours),
      ]),
    },
    {
      name: "Top 10 Hours",
      headers: ["Callsign / Name", "Total Hours"],
      rows: report.topHours.map((m) => [callSignName(m.callSign, m.name), String(m.totalHours)]),
    },
    {
      name: "Top 10 KM",
      headers: ["Callsign / Name", "Total KM"],
      rows: report.topKm.map((m) => [callSignName(m.callSign, m.name), String(m.totalKm)]),
    },
  ]);
  downloadText(
    `patrol-summary-${stamp(report.from, report.to)}.xls`,
    xml,
    "application/vnd.ms-excel;charset=utf-8;",
  );
}
