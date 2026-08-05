/** Normalizes a Saudi local number (leading 0) to the +966 country code
 * wa.me expects. Mirrors frontend/src/components/maskan/ContactButtons.tsx's
 * whatsappLink so both platforms build the same URL from the same phone
 * formats. */
export function whatsappLink(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "").replace(/^0/, "966")}`;
}
