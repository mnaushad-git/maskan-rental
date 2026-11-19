// Saves a downloaded transaction document with a readable filename.
// Blob URLs opened in a new tab are saved by the browser under the blob's
// random id (e.g. "dcb99ab4-….pdf"); an <a download> with a real name avoids
// that. The name is built from the document label (+ optional transaction
// reference) and the file's actual type.

const EXT_BY_TYPE: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

export function documentFileName(
  label: string,
  blobType: string,
  reference?: string | null,
): string {
  const base =
    [reference, label]
      .filter(Boolean)
      .join(" ")
      .replace(/[\\:*?"<>|/]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "document";
  const ext = EXT_BY_TYPE[blobType] ?? "";
  return base.toLowerCase().endsWith(ext) ? base : base + ext;
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement("a");
  a.href = url;
  a.download = filename;
  window.document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
