import { Link, useNavigate } from "@tanstack/react-router";
import { ClipboardList, LogOut, User } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { NotificationBell } from "./NotificationBell";
import { cn } from "@/lib/utils";

export function NavAuthButton({ className }: { className?: string }) {
  const { user, clearAuth } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  if (!user) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/auth">Sign in</Link>
        </Button>
      </div>
    );
  }

  const initials = user.full_name
    ? user.full_name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()
    : user.email.slice(0, 2).toUpperCase();

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Notification bell — only for customers */}
      <NotificationBell />

      {/* User avatar + dropdown */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-surface transition-colors"
        >
          <span className="grid size-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
            {initials}
          </span>
          <span className="hidden max-w-[120px] truncate md:block">{user.full_name ?? user.email}</span>
        </button>

        {open && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-30 cursor-default"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
            />
            <div className="absolute end-0 z-40 mt-2 w-48 overflow-hidden rounded-xl border border-border bg-popover py-1 text-sm shadow-elevated">
              <div className="border-b border-border px-3 py-2.5">
                <div className="font-semibold truncate">{user.full_name ?? "Account"}</div>
                <div className="text-xs text-muted-foreground truncate">{user.email}</div>
              </div>
              <button
                type="button"
                onClick={() => { navigate({ to: "/saved" }); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-2"
              >
                <User className="size-3.5 text-muted-foreground" /> Saved properties
              </button>
              <button
                type="button"
                onClick={() => { navigate({ to: "/my-leads" }); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-2"
              >
                <ClipboardList className="size-3.5 text-muted-foreground" /> My leads
              </button>
              {user.is_admin && (
                <button
                  type="button"
                  onClick={() => { navigate({ to: "/admin" }); setOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-2"
                >
                  <User className="size-3.5 text-muted-foreground" /> Admin console
                </button>
              )}
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={() => { clearAuth(); setOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-destructive hover:bg-surface-2"
              >
                <LogOut className="size-3.5" /> Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
