import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

/** Back-to-console link shown in the header of every standalone admin page. */
export function AdminBackLink() {
  return (
    <Link
      to="/admin"
      aria-label="Back to Admin Console"
      title="Back to Admin Console"
      className="grid size-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-surface hover:text-foreground"
    >
      <ArrowLeft className="size-4 rtl:rotate-180" />
    </Link>
  );
}
