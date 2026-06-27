import { Send, Sparkles } from "lucide-react";
import { Badge } from "./Badges";

type Msg = { role: "user" | "ai"; text: string };

const transcript: Msg[] = [
  { role: "user", text: "Find me a 3BR family apartment in North Riyadh under SAR 160K." },
  {
    role: "ai",
    text: "I found 24 strong matches. Top picks are in Al Yasmin and Al Malqa — both have good school access and average ~12% below comparable Olaya listings.",
  },
  { role: "user", text: "Compare the top two for me." },
];

export function AiChatPanel() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card">
      <header className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-ai-soft text-ai">
            <Sparkles className="size-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">Maskan AI</div>
            <div className="text-xs text-muted-foreground">Rental intelligence assistant</div>
          </div>
        </div>
        <Badge tone="success">
          <span className="size-1.5 rounded-full bg-success" /> Online
        </Badge>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {transcript.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ms-auto max-w-[85%] rounded-2xl rounded-ee-md bg-primary px-4 py-2.5 text-sm text-primary-foreground"
                : "max-w-[90%] rounded-2xl rounded-es-md bg-surface px-4 py-3 text-sm"
            }
          >
            {m.text}
          </div>
        ))}
        <div className="max-w-[90%] rounded-2xl rounded-es-md border border-ai/20 bg-ai-soft/60 px-4 py-3 text-sm">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ai">
            <Sparkles className="size-3.5" /> Comparing 2 properties…
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-card p-2.5">
              <div className="font-semibold">Al Yasmin Villa</div>
              <div className="text-muted-foreground">SAR 145K · 96 match</div>
            </div>
            <div className="rounded-lg bg-card p-2.5">
              <div className="font-semibold">Al Malqa Apt.</div>
              <div className="text-muted-foreground">SAR 138K · 91 match</div>
            </div>
          </div>
        </div>
      </div>

      <form className="flex items-center gap-2 border-t border-border p-3">
        <input
          placeholder="Ask Maskan anything about rentals…"
          className="flex-1 rounded-xl bg-surface px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:bg-surface-2"
        />
        <button
          type="button"
          aria-label="Send"
          className="grid size-10 place-items-center rounded-xl bg-ai text-ai-foreground transition-colors hover:bg-ai/90"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
