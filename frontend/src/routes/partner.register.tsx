import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { TopNav } from "@/components/maskan/TopNav";
import { useState } from "react";
import { ArrowLeft, Briefcase, CheckCircle, CreditCard, Eye, EyeOff, ShieldCheck, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { registerPartner, signup, subscribePartnerMock } from "@/lib/api/maskan";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/partner/register")({
  head: () => ({ meta: [{ title: "Become a Partner — Maskan" }] }),
  component: PartnerRegisterPage,
});

function PartnerRegisterPage() {
  const { user, authLoading, setAuth } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<"form" | "payment" | "done">("form");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [account, setAccount] = useState({ full_name: "", email: "", password: "", confirmPassword: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ license_number: "", agency_name: "", phone: "", bio: "" });

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      // Step 1 — create account if not already signed in
      if (!user) {
        if (!account.email.trim() || !account.password.trim()) {
          setError("Email and password are required.");
          return;
        }
        if (account.password.length < 6) {
          setError("Password must be at least 6 characters.");
          return;
        }
        if (account.password !== account.confirmPassword) {
          setError("Passwords do not match.");
          return;
        }
        const authResp = await signup({
          email: account.email.trim(),
          password: account.password,
          full_name: account.full_name.trim() || undefined,
        });
        setAuth(authResp.user, authResp.access_token);
      }

      // Step 2 — register partner profile
      await registerPartner({
        license_number: form.license_number,
        agency_name: form.agency_name || undefined,
        phone: form.phone,
        bio: form.bio || undefined,
      });

      setStep("payment");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Registration failed";
      if (msg.toLowerCase().includes("already registered") || msg.includes("already have a partner")) {
        setError("already-registered");
      } else if (msg.toLowerCase().includes("already exists") || msg.toLowerCase().includes("email")) {
        setError("email-exists");
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePayment() {
    setError("");
    setSubmitting(true);
    try {
      await subscribePartnerMock();
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const steps = [
    { id: "form", label: "Profile" },
    { id: "payment", label: "Subscribe" },
    { id: "done", label: "Active" },
  ];

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <div className="px-4 py-12">
      <div className="mx-auto max-w-lg">

        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Briefcase className="size-7" />
          </div>
          <h1 className="text-2xl font-bold">Become a Maskan Partner</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect tenants with the right properties and earn from every closed deal.
          </p>
        </div>

        {/* Step indicators */}
        <div className="mb-8 flex items-center justify-center gap-2">
          {steps.map((s, i) => {
            const currentIdx = steps.findIndex(x => x.id === step);
            const done = currentIdx > i;
            const active = step === s.id;
            return (
              <div key={s.id} className="flex items-center gap-2">
                <div className={cn(
                  "flex size-8 items-center justify-center rounded-full text-xs font-bold transition-colors",
                  active ? "bg-primary text-primary-foreground" :
                  done ? "bg-success text-white" : "bg-surface-2 text-muted-foreground"
                )}>
                  {done ? <CheckCircle className="size-4" /> : i + 1}
                </div>
                <span className={cn("text-sm font-medium", active ? "text-foreground" : "text-muted-foreground")}>
                  {s.label}
                </span>
                {i < steps.length - 1 && <div className="h-px w-8 bg-border" />}
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl border border-border bg-card p-8 shadow-card">
          {step === "form" && (
            <form onSubmit={handleRegister} className="space-y-5">
              <h2 className="text-lg font-semibold">Your partner profile</h2>

              {/* Account section — shown only when not logged in */}
              {!authLoading && !user && (
                <div className="space-y-4 rounded-xl border border-border bg-surface/60 p-4">
                  <p className="text-sm font-medium text-foreground">
                    Create your Maskan account
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      Already have one?{" "}
                      <Link to="/auth" className="text-primary underline underline-offset-2">
                        Sign in →
                      </Link>
                    </span>
                  </p>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Full name</label>
                    <Input
                      value={account.full_name}
                      onChange={e => setAccount(a => ({ ...a, full_name: e.target.value }))}
                      placeholder="Ahmed Al-Saud"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">
                      Email <span className="text-destructive">*</span>
                    </label>
                    <Input
                      required
                      type="email"
                      value={account.email}
                      onChange={e => setAccount(a => ({ ...a, email: e.target.value }))}
                      placeholder="ahmed@example.com"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">
                      Password <span className="text-destructive">*</span>
                    </label>
                    <div className="relative">
                      <Input
                        required
                        type={showPassword ? "text" : "password"}
                        value={account.password}
                        onChange={e => setAccount(a => ({ ...a, password: e.target.value }))}
                        placeholder="Min. 6 characters"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">
                      Confirm password <span className="text-destructive">*</span>
                    </label>
                    <Input
                      required
                      type={showPassword ? "text" : "password"}
                      value={account.confirmPassword}
                      onChange={e => setAccount(a => ({ ...a, confirmPassword: e.target.value }))}
                      placeholder="Re-enter password"
                    />
                  </div>
                </div>
              )}

              {/* Signed-in indicator */}
              {!authLoading && user && (
                <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/8 px-3 py-2.5 text-sm text-success">
                  <UserCheck className="size-4 shrink-0" />
                  Signed in as <span className="font-semibold">{user.email}</span>
                </div>
              )}

              {/* Divider */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                Partner details
                <div className="h-px flex-1 bg-border" />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  REGA License Number <span className="text-destructive">*</span>
                </label>
                <Input
                  required
                  value={form.license_number}
                  onChange={e => setForm(f => ({ ...f, license_number: e.target.value }))}
                  placeholder="e.g. 1234567890"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Agency / Brokerage Name</label>
                <Input
                  value={form.agency_name}
                  onChange={e => setForm(f => ({ ...f, agency_name: e.target.value }))}
                  placeholder="e.g. Al Noor Real Estate"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Phone Number <span className="text-destructive">*</span>
                </label>
                <Input
                  required
                  type="tel"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="+966 5X XXX XXXX"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">About you</label>
                <textarea
                  rows={3}
                  value={form.bio}
                  onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
                  placeholder="Brief description of your experience and specialties…"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none"
                />
              </div>

              {/* Error messages */}
              {error === "email-exists" && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  An account with this email already exists.{" "}
                  <Link to="/auth" className="font-semibold underline">Sign in →</Link>
                  {" "}then come back to complete registration.
                </div>
              )}
              {error === "already-registered" && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  You already have a partner profile.{" "}
                  <Link to="/partner" className="font-semibold underline">Go to dashboard →</Link>
                </div>
              )}
              {error && error !== "email-exists" && error !== "already-registered" && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={submitting || authLoading}>
                {submitting ? "Registering…" : "Continue to payment"}
              </Button>
            </form>
          )}

          {step === "payment" && (
            <div className="space-y-6">
              <h2 className="text-lg font-semibold">Subscribe to activate</h2>
              <div className="rounded-xl border border-border bg-surface p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">Standard Partner Plan</div>
                    <div className="text-sm text-muted-foreground">
                      Unlimited area coverage · Lead notifications · Dashboard access
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold">SAR 99</div>
                    <div className="text-xs text-muted-foreground">/month</div>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-surface p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <CreditCard className="size-4" /> Payment details (mock)
                </div>
                <div className="space-y-3">
                  <Input placeholder="Card number" disabled defaultValue="•••• •••• •••• ••••" />
                  <div className="grid grid-cols-2 gap-3">
                    <Input placeholder="MM/YY" disabled defaultValue="••/••" />
                    <Input placeholder="CVV" disabled defaultValue="•••" />
                  </div>
                </div>
              </div>
              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <Button className="w-full" onClick={handlePayment} disabled={submitting}>
                {submitting ? "Processing…" : "Pay SAR 99 and activate"}
              </Button>
            </div>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div className="grid size-16 place-items-center rounded-full bg-warning/10 text-warning">
                <ShieldCheck className="size-8" />
              </div>
              <h2 className="text-xl font-bold">Registration submitted!</h2>
              <p className="text-sm text-muted-foreground">
                Your partner account is now <span className="font-semibold text-foreground">pending Maskanai Admin approval</span>.
                You'll get full access to your dashboard and leads once an admin approves your account.
              </p>
              <Button className="w-full" onClick={() => navigate({ to: "/partner" })}>
                Check approval status
              </Button>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
