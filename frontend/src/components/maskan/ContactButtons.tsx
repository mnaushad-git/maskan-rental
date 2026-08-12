import { Phone } from "lucide-react";

/** Brand-standard WhatsApp glyph — kept as inline SVG (no icon package ships
 * it) rather than duplicated per call site. Exported since a few call sites
 * (agent profile hero, property-detail sticky bar) need the icon inside a
 * differently-shaped button than the standard two-button `ContactButtons`
 * row. */
export function WhatsAppIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} fill-current`} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

export function whatsappLink(phone: string) {
  return `https://wa.me/${phone.replace(/\D/g, "").replace(/^0/, "966")}`;
}

/** Call + WhatsApp contact row shared by every property-card variant
 * (PropertyCard, search results, saved list) — previously hand-duplicated
 * (including the WhatsApp SVG path) in all three places. */
export function ContactButtons({
  phone,
  whatsappPhone,
  callLabel,
  whatsappLabel,
}: {
  phone: string;
  /** Defaults to `phone` when the listing has no separate WhatsApp number. */
  whatsappPhone?: string;
  callLabel: string;
  whatsappLabel: string;
}) {
  return (
    <div className="flex gap-2 border-t border-border px-5 py-3">
      <a
        href={`tel:${phone}`}
        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface"
      >
        <Phone className="size-3.5" /> {callLabel}
      </a>
      <a
        href={whatsappLink(whatsappPhone || phone)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-whatsapp bg-whatsapp/10 py-2 text-xs font-medium text-whatsapp-foreground transition-colors hover:bg-whatsapp/20 dark:text-whatsapp"
      >
        <WhatsAppIcon />
        {whatsappLabel}
      </a>
    </div>
  );
}
