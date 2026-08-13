import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  History,
  Layers,
  Loader2,
  Search,
  Upload,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatCard, FilterChip } from "@/components/maskan/Widgets";
import { bulkImportProperties, type BulkImportRow } from "@/lib/api/maskan";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/import")({
  head: () => ({
    meta: [
      { title: "Data Import Console — myMakan" },
      {
        name: "description",
        content:
          "Upload CSV or Excel listings, validate records, review errors and track every import batch in myMakan's data console.",
      },
    ],
  }),
  component: ImportPage,
});

type ErrorType =
  | "Missing Rent"
  | "Missing Title"
  | "Missing City"
  | "Invalid District"
  | "Duplicate Property"
  | "Invalid Bedrooms";

type ErrorRow = {
  row: number;
  property: string;
  district: string;
  field: string;
  error: ErrorType;
  severity: "error" | "warning";
  suggestion: string;
};

type Batch = {
  id: string;
  fileName: string;
  fileType: "CSV" | "XLSX";
  date: string;
  uploadedBy: string;
  email: string;
  records: number;
  valid: number;
  invalid: number;
  duplicates: number;
  status: "Completed" | "Partial" | "Failed" | "Processing";
};

type Summary = { received: number; valid: number; invalid: number; duplicates: number };

const SAMPLE_BATCHES: Batch[] = [
  {
    id: "BTH-2026-0598",
    fileName: "jeddah_coastal_may.csv",
    fileType: "CSV",
    date: "Jun 4, 2026 · 16:08",
    uploadedBy: "Layla Al-Subaie",
    email: "layla@maskan.sa",
    records: 642,
    valid: 631,
    invalid: 7,
    duplicates: 4,
    status: "Completed",
  },
  {
    id: "BTH-2026-0571",
    fileName: "dammam_new_compounds.xlsx",
    fileType: "XLSX",
    date: "May 28, 2026 · 09:21",
    uploadedBy: "Omar Bin Saleh",
    email: "omar@maskan.sa",
    records: 318,
    valid: 296,
    invalid: 22,
    duplicates: 0,
    status: "Partial",
  },
  {
    id: "BTH-2026-0544",
    fileName: "agent_portfolio_noura.csv",
    fileType: "CSV",
    date: "May 19, 2026 · 14:55",
    uploadedBy: "Noura Al-Qahtani",
    email: "noura@maskan.sa",
    records: 84,
    valid: 84,
    invalid: 0,
    duplicates: 0,
    status: "Completed",
  },
];

const errorTypes: ErrorType[] = [
  "Missing Rent",
  "Missing Title",
  "Missing City",
  "Invalid District",
  "Duplicate Property",
  "Invalid Bedrooms",
];

/* ---- CSV helpers --------------------------------------------------------- */

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
  return lines.slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
    });
}

function validateRows(
  rows: Record<string, string>[],
): { errors: ErrorRow[]; valid: BulkImportRow[]; duplicates: number } {
  const errors: ErrorRow[] = [];
  const valid: BulkImportRow[] = [];
  const seenIds = new Set<string>();
  let duplicates = 0;

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // 1-based + header row
    const name = row.title?.trim() || `Row ${rowNum}`;
    const district = (row.area || row.district || "").trim();
    const rowErrors: ErrorRow[] = [];

    if (!name || name === `Row ${rowNum}`) {
      rowErrors.push({
        row: rowNum, property: name, district, field: "title",
        error: "Missing Title", severity: "error", suggestion: "Add a property title",
      });
    }
    if (!district) {
      rowErrors.push({
        row: rowNum, property: name, district: "—", field: "area",
        error: "Invalid District", severity: "error", suggestion: "Add area name (e.g. Al Yasmin)",
      });
    }
    if (!(row.city || "").trim()) {
      rowErrors.push({
        row: rowNum, property: name, district, field: "city",
        error: "Missing City", severity: "error", suggestion: "Add city (Riyadh, Jeddah, Dammam…)",
      });
    }
    const rent = parseFloat(row.rent_sar || row.monthly_rent || "");
    if (!rent || rent <= 0) {
      rowErrors.push({
        row: rowNum, property: name, district, field: "rent_sar",
        error: "Missing Rent", severity: "error", suggestion: "Add monthly rent in SAR (positive number)",
      });
    }
    const beds = parseInt(row.bedrooms || "");
    if (row.bedrooms && (isNaN(beds) || beds < 1 || beds > 20)) {
      rowErrors.push({
        row: rowNum, property: name, district, field: "bedrooms",
        error: "Invalid Bedrooms", severity: "error",
        suggestion: `Value '${row.bedrooms}' — must be integer 1–20`,
      });
    }
    const extId = (row.external_id || row.property_id || "").trim();
    if (extId && seenIds.has(extId)) {
      rowErrors.push({
        row: rowNum, property: name, district, field: "external_id",
        error: "Duplicate Property", severity: "warning",
        suggestion: `${extId} appears more than once in this file`,
      });
      duplicates++;
    }
    if (extId) seenIds.add(extId);

    errors.push(...rowErrors);

    if (rowErrors.every((e) => e.severity === "warning")) {
      valid.push({
        external_id: extId || undefined,
        title: name,
        area: district,
        city: (row.city || "").trim(),
        monthly_rent: rent,
        bedrooms: isNaN(beds) ? undefined : beds,
        bathrooms: parseInt(row.bathrooms || "") || undefined,
        size_sq_m: parseFloat(row.area_sqm || "") || undefined,
        owner_name: (row.owner_name || row.owner_id || "").trim() || undefined,
        status: "Published",
      });
    }
  });

  return { errors, valid, duplicates };
}

/* ---- Page ---------------------------------------------------------------- */

function ImportPage() {
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState<{ name: string; size: string; type: "CSV" | "XLSX" } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [errors, setErrors] = useState<ErrorRow[]>([]);
  const [validRows, setValidRows] = useState<BulkImportRow[]>([]);
  const [batches, setBatches] = useState<Batch[]>(SAMPLE_BATCHES);
  const [importResult, setImportResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const [errorFilter, setErrorFilter] = useState<ErrorType | "All">("All");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredErrors = useMemo(() => {
    return errors.filter((e) => {
      const matchesType = errorFilter === "All" || e.error === errorFilter;
      const q = query.trim().toLowerCase();
      const matchesQuery =
        !q ||
        e.property.toLowerCase().includes(q) ||
        e.district.toLowerCase().includes(q) ||
        String(e.row).includes(q);
      return matchesType && matchesQuery;
    });
  }, [errors, errorFilter, query]);

  const validPct = summary ? Math.round((summary.valid / Math.max(1, summary.received)) * 100) : 0;

  const processFile = (f: File) => {
    const ext = f.name.toLowerCase().endsWith(".csv") ? "CSV" : "XLSX";
    setFile({ name: f.name, size: `${(f.size / 1024).toFixed(0)} KB`, type: ext });
    setUploading(true);
    setProgress(0);
    setImportResult(null);
    setSummary(null);
    setErrors([]);
    setValidRows([]);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;

      // Animate progress while we parse
      let p = 0;
      const tick = setInterval(() => {
        p = Math.min(p + 15, 90);
        setProgress(p);
      }, 80);

      const rows = parseCSV(text);
      const { errors: rowErrors, valid, duplicates } = validateRows(rows);

      clearInterval(tick);
      setProgress(100);
      setUploading(false);

      setErrors(rowErrors);
      setValidRows(valid);
      setSummary({
        received: rows.length,
        valid: valid.length,
        invalid: rowErrors.filter((e) => e.severity === "error").length,
        duplicates,
      });
    };
    reader.onerror = () => setUploading(false);
    reader.readAsText(f);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) processFile(f);
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  };

  const handleImport = async () => {
    if (!validRows.length || !file) return;
    setImporting(true);
    try {
      const result = await bulkImportProperties(validRows);
      setImportResult(result);
      const now = new Date();
      const dateStr = `${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
      setBatches((prev) => [
        {
          id: `BTH-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(4, "0")}${String(now.getDate()).padStart(2, "0")}`,
          fileName: file.name,
          fileType: file.type,
          date: dateStr,
          uploadedBy: "You",
          email: "—",
          records: summary?.received ?? validRows.length,
          valid: result.inserted,
          invalid: summary?.invalid ?? 0,
          duplicates: result.skipped,
          status: result.inserted > 0 ? "Completed" : "Failed",
        },
        ...prev,
      ]);
    } catch {
      setImportResult(null);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-4 sm:gap-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Link
              to="/admin"
              className="inline-flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> <span className="hidden sm:inline">Admin Console</span>
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="truncate text-sm font-semibold">Data Import</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href="data:text/csv;charset=utf-8,external_id%2Ctitle%2Carea%2Ccity%2Crent_sar%2Cbedrooms%2Cbathrooms%2Carea_sqm%2Cowner_name%0AMSK-101%2CModern%202BR%20-%20Al%20Yasmin%2CAl%20Yasmin%2CRiyadh%2C8500%2C2%2C2%2C120%2CAhmed%20Al-Harbi"
              download="maskan_import_template.csv"
            >
              <Button variant="outline" size="sm">
                <Download className="size-4" /> <span className="hidden sm:inline">Download template</span>
              </Button>
            </a>
            <Button size="sm" onClick={() => inputRef.current?.click()}>
              <UploadCloud className="size-4" /> <span className="hidden sm:inline">New import</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-6 py-8">
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-ai/10 text-ai">
              Data Console
            </Badge>
            <span className="text-xs text-muted-foreground">Live · Pipeline</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Bulk listing import</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Upload a CSV file to onboard listings in bulk. myMakan validates each row against required
            fields and publishing rules before inserting into the database.
          </p>
        </section>

        {/* Upload area */}
        <section
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={cn(
            "relative overflow-hidden rounded-3xl border-2 border-dashed bg-card p-8 shadow-card transition-colors",
            drag ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          <div className="grid grid-cols-1 gap-8 md:grid-cols-[1.4fr_1fr] md:items-center">
            <div className="flex flex-col items-start gap-4">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <UploadCloud className="size-7" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Drop your CSV file here</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  CSV up to 25 MB · UTF-8 encoded · one property per row
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => inputRef.current?.click()}>
                  <Upload className="size-4" /> Choose file
                </Button>
                {summary && summary.valid > 0 && (
                  <Button
                    variant="default"
                    className="bg-success text-success-foreground hover:bg-success/90"
                    onClick={handleImport}
                    disabled={importing}
                  >
                    {importing ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                    {importing ? "Importing…" : `Import ${summary.valid} valid rows`}
                  </Button>
                )}
                <input
                  ref={inputRef}
                  type="file"
                  className="hidden"
                  accept=".csv"
                  onChange={onPick}
                />
              </div>
              {importResult && (
                <div className="rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
                  <CheckCircle2 className="mr-2 inline size-4" />
                  <strong>{importResult.inserted}</strong> properties inserted
                  {importResult.skipped > 0 && (
                    <span className="ml-2 text-muted-foreground">
                      · {importResult.skipped} skipped (duplicate IDs)
                    </span>
                  )}
                </div>
              )}
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="secondary" className="gap-1 bg-success/10 text-success">
                  <FileText className="size-3" /> CSV
                </Badge>
                <Badge variant="outline" className="gap-1">Auto-deduplication</Badge>
                <Badge variant="outline" className="gap-1">District matching</Badge>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-surface/60 p-5">
              {file ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-success/10 text-success">
                      <FileText className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{file.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {file.type} · {file.size}
                      </div>
                    </div>
                    {uploading ? (
                      <Loader2 className="size-4 animate-spin text-primary" />
                    ) : (
                      <CheckCircle2 className="size-4 text-success" />
                    )}
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{uploading ? "Validating rows…" : "Validation complete"}</span>
                    <span>{progress}%</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="font-semibold">Required CSV columns</div>
                  <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <li>• external_id <span className="text-muted-foreground/60">(optional)</span></li>
                    <li>• title <span className="text-destructive">*</span></li>
                    <li>• area <span className="text-destructive">*</span></li>
                    <li>• city <span className="text-destructive">*</span></li>
                    <li>• rent_sar <span className="text-destructive">*</span></li>
                    <li>• bedrooms</li>
                    <li>• bathrooms</li>
                    <li>• area_sqm</li>
                    <li>• owner_name</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Validation summary */}
        {summary && (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Records received"
              value={summary.received.toLocaleString()}
              delta={`from ${file?.name ?? "file"}`}
              trend="up"
              icon={<Layers className="size-4" />}
            />
            <StatCard
              label="Valid records"
              value={summary.valid.toLocaleString()}
              delta={`${validPct}% pass rate`}
              trend="up"
              icon={<CheckCircle2 className="size-4 text-success" />}
            />
            <StatCard
              label="Invalid records"
              value={summary.invalid.toLocaleString()}
              delta="Schema or value errors"
              trend="down"
              icon={<XCircle className="size-4 text-destructive" />}
            />
            <StatCard
              label="Duplicates"
              value={summary.duplicates.toLocaleString()}
              delta="Found in this file"
              trend="down"
              icon={<Copy className="size-4 text-info" />}
            />
          </section>
        )}

        {/* Error grid — only shown after a file is parsed */}
        {summary && (
          <section className="rounded-2xl border border-border bg-card shadow-card">
            <div className="flex flex-col gap-3 border-b border-border p-5 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Validation errors</h2>
                <p className="text-xs text-muted-foreground">
                  {filteredErrors.length} issues · Resolve and re-upload affected rows
                </p>
              </div>
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search row, property, district…"
                    className="w-full pl-9 md:w-72"
                  />
                </div>
                <Button variant="outline" size="sm">
                  <Filter className="size-4" /> Export errors
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-b border-border p-4">
              <FilterChip
                label={`All (${errors.length})`}
                active={errorFilter === "All"}
                onClick={() => setErrorFilter("All")}
              />
              {errorTypes.map((t) => {
                const count = errors.filter((e) => e.error === t).length;
                if (count === 0) return null;
                return (
                  <FilterChip
                    key={t}
                    label={`${t} · ${count}`}
                    active={errorFilter === t}
                    onClick={() => setErrorFilter(t)}
                  />
                );
              })}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 text-left font-semibold">Row</th>
                    <th className="px-5 py-3 text-left font-semibold">Property</th>
                    <th className="px-5 py-3 text-left font-semibold">District</th>
                    <th className="px-5 py-3 text-left font-semibold">Field</th>
                    <th className="px-5 py-3 text-left font-semibold">Error</th>
                    <th className="px-5 py-3 text-left font-semibold">Suggested fix</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredErrors.map((e, i) => (
                    <tr key={i} className="border-t border-border hover:bg-surface/40">
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">#{e.row}</td>
                      <td className="px-5 py-3 font-medium">{e.property}</td>
                      <td className="px-5 py-3 text-muted-foreground">{e.district}</td>
                      <td className="px-5 py-3">
                        <code className="rounded bg-surface px-2 py-0.5 text-xs">{e.field}</code>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                            e.severity === "error"
                              ? "bg-destructive/10 text-destructive"
                              : "bg-warning/10 text-warning",
                          )}
                        >
                          {e.severity === "error" ? (
                            <XCircle className="size-3" />
                          ) : (
                            <AlertTriangle className="size-3" />
                          )}
                          {e.error}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">{e.suggestion}</td>
                    </tr>
                  ))}
                  {filteredErrors.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-sm text-muted-foreground">
                        {errors.length === 0 ? "No validation errors — all rows are ready to import." : "No errors match your filters."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Import history */}
        <section className="rounded-2xl border border-border bg-card shadow-card">
          <div className="flex items-center justify-between border-b border-border p-5">
            <div className="flex items-center gap-2">
              <History className="size-4 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Import history</h2>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left font-semibold">Batch ID</th>
                  <th className="px-5 py-3 text-left font-semibold">File</th>
                  <th className="px-5 py-3 text-left font-semibold">Date</th>
                  <th className="px-5 py-3 text-left font-semibold">Records</th>
                  <th className="px-5 py-3 text-left font-semibold">Status</th>
                  <th className="px-5 py-3 text-left font-semibold">Uploaded by</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-t border-border hover:bg-surface/40">
                    <td className="px-5 py-3 font-mono text-xs">{b.id}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            "flex size-7 items-center justify-center rounded-md",
                            b.fileType === "CSV"
                              ? "bg-success/10 text-success"
                              : "bg-info/10 text-info",
                          )}
                        >
                          {b.fileType === "CSV" ? (
                            <FileText className="size-3.5" />
                          ) : (
                            <FileSpreadsheet className="size-3.5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{b.fileName}</div>
                          <div className="text-xs text-muted-foreground">{b.fileType}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{b.date}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3 text-xs">
                        <span className="font-semibold">{b.records.toLocaleString()}</span>
                        <span className="text-success">✓ {b.valid.toLocaleString()}</span>
                        <span className="text-destructive">✕ {b.invalid.toLocaleString()}</span>
                        <span className="text-info">⎘ {b.duplicates}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <ImportStatusBadge status={b.status} />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {b.uploadedBy
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .slice(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{b.uploadedBy}</div>
                          <div className="text-xs text-muted-foreground">{b.email}</div>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function ImportStatusBadge({ status }: { status: Batch["status"] }) {
  const map: Record<Batch["status"], string> = {
    Completed: "bg-success/10 text-success",
    Partial: "bg-warning/10 text-warning",
    Failed: "bg-destructive/10 text-destructive",
    Processing: "bg-info/10 text-info",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        map[status],
      )}
    >
      {status === "Processing" && <Loader2 className="size-3 animate-spin" />}
      {status}
    </span>
  );
}
