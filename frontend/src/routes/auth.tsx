import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Home,
  Lock,
  Mail,
  Shield,
  Sparkles,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/maskan/Badges";
import { login, signup } from "@/lib/api/maskan";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in or create your Maskan account" },
      {
        name: "description",
        content:
          "Access your saved homes, AI Advisor and area insights. Sign in or create a free Maskan account.",
      },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup";

function AuthPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (mode === "signup" && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);

    try {
      const response =
        mode === "signin"
          ? await login({ email, password })
          : await signup({ email, password, full_name: fullName || undefined });

      setAuth(response.user, response.access_token);
      void navigate({ to: "/" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (mode === "signin") {
        setError("Invalid email or password.");
      } else if (msg.toLowerCase().includes("email already") || msg.includes("409") || msg.includes("Conflict")) {
        setError("This email is already registered. Try signing in instead.");
      } else if (msg && !msg.includes("500") && !msg.includes("Request failed")) {
        setError(msg);
      } else {
        setError("Unable to create account. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="container-page flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Home className="size-4" />
            </div>
            <span className="font-display text-xl font-bold tracking-tight">Maskan</span>
          </Link>
          <div className="text-sm text-muted-foreground">
            {mode === "signin" ? "New to Maskan?" : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="font-semibold text-primary hover:underline"
            >
              {mode === "signin" ? "Create account" : "Sign in"}
            </button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 min-h-[calc(100vh-4rem)] lg:grid-cols-[1fr_1.05fr]">
        {/* Left: marketing panel */}
        <aside className="relative hidden overflow-hidden bg-gradient-to-br from-primary via-primary to-ai p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
          <div className="absolute -right-24 -top-24 size-80 rounded-full bg-primary-foreground/10 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 size-96 rounded-full bg-ai-soft/20 blur-3xl" />

          <div className="relative">
            <Badge tone="ai" className="mb-6 border-white/20 bg-white/15 text-white">
              <Sparkles className="size-3.5" /> Maskan AI
            </Badge>
            <h1 className="font-display text-4xl font-bold leading-[1.1] tracking-tight">
              Smarter rentals,
              <br />
              made for Saudi.
            </h1>
            <p className="mt-4 max-w-md text-base text-primary-foreground/85">
              Save favorite homes, compare neighborhoods and get AI-powered insights on fair rent —
              all in one account.
            </p>
          </div>

          <ul className="relative space-y-4">
            {[
              "AI fairness check on every listing",
              "Side-by-side area & property comparison",
              "Verified listings across 5 Saudi cities",
            ].map((b) => (
              <li key={b} className="flex items-center gap-3 text-sm">
                <span className="grid size-7 place-items-center rounded-full bg-white/15">
                  <CheckCircle2 className="size-4" />
                </span>
                {b}
              </li>
            ))}
          </ul>

          <div className="relative rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-white/20">
                <Shield className="size-5" />
              </div>
              <div className="text-sm">
                <div className="font-semibold">Trusted by 38,000+ renters</div>
                <div className="text-primary-foreground/80">
                  Bank-grade encryption · No spam, ever
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Right: form */}
        <main className="flex items-center justify-center px-6 py-12 sm:px-10">
          <div className="w-full max-w-md">
            <div className="mb-6 inline-flex rounded-xl border border-border bg-card p-1 shadow-card">
              {(["signin", "signup"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={
                    "rounded-lg px-5 py-2 text-sm font-semibold transition-all " +
                    (mode === m
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {m === "signin" ? "Sign in" : "Sign up"}
                </button>
              ))}
            </div>

            <h2 className="font-display text-3xl font-bold tracking-tight">
              {mode === "signin" ? "Welcome back" : "Create your account"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {mode === "signin"
                ? "Sign in to continue your home search and access saved listings."
                : "Join Maskan to save homes, compare areas and unlock AI insights."}
            </p>

            {/* Social */}
            <div className="mt-7 grid grid-cols-2 gap-3">
              <SocialButton provider="google" />
              <SocialButton provider="apple" />
            </div>

            <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or continue with email{" "}
              <span className="h-px flex-1 bg-border" />
            </div>

            <form
              className="space-y-4"
              onSubmit={handleSubmit}
            >
              {mode === "signup" && (
                <Field icon={User} label="Full name" type="text" placeholder="Ahmed Al-Saud" value={fullName} onChange={setFullName} />
              )}
              <Field
                icon={Mail}
                label="Email address"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={setEmail}
              />


              <div>
                <label className="mb-1.5 block text-sm font-medium">Password</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "signup" ? "Create a strong password" : "Your password"}
                    className="h-11 w-full rounded-lg border border-border bg-card px-10 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute end-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-surface hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {mode === "signin" ? (
                <div className="flex items-center justify-between text-sm">
                  <label className="inline-flex items-center gap-2 text-muted-foreground">
                    <input type="checkbox" className="size-4 rounded border-border" />
                    Remember me
                  </label>
                  <a href="#" className="font-semibold text-primary hover:underline">
                    Forgot password?
                  </a>
                </div>
              ) : (
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" className="mt-0.5 size-4 rounded border-border" />
                  <span>
                    I agree to the{" "}
                    <a href="#" className="font-semibold text-foreground hover:underline">
                      Terms
                    </a>{" "}
                    and{" "}
                    <a href="#" className="font-semibold text-foreground hover:underline">
                      Privacy Policy
                    </a>
                    .
                  </span>
                </label>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" variant="hero" size="lg" className="w-full" disabled={loading || !email || !password || (mode === "signup" && !fullName)}>
                {mode === "signin" ? "Sign in" : "Create account"} <ArrowRight />
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              {mode === "signin" ? "Don't have an account? " : "Already a member? "}
              <button
                type="button"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                className="font-semibold text-primary hover:underline"
              >
                {mode === "signin" ? "Sign up" : "Sign in"}
              </button>
            </p>

            <div className="mt-10 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="size-3.5" /> © {new Date().getFullYear()} Maskan · Riyadh, KSA
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  type,
  placeholder,
  value,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  type: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      <div className="relative">
        <Icon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full rounded-lg border border-border bg-card px-10 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>
    </div>
  );
}

function SocialButton({ provider }: { provider: "google" | "apple" }) {
  const isGoogle = provider === "google";
  return (
    <button
      type="button"
      disabled
      title="Coming soon"
      className="inline-flex h-11 cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm font-semibold text-muted-foreground opacity-50"
    >
      {isGoogle ? <GoogleIcon /> : <AppleIcon />}
      {isGoogle ? "Google" : "Apple"}
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.9 9.1-9.3 0-.6-.1-1.1-.2-1.6H12z"
      />
    </svg>
  );
}
function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 fill-foreground" aria-hidden="true">
      <path d="M16.4 12.7c0-2.6 2.1-3.9 2.2-4-1.2-1.8-3.1-2-3.8-2-1.6-.2-3.1.9-3.9.9-.8 0-2.1-.9-3.4-.9C5.4 6.8 3.5 8 2.5 9.9c-1.8 3.1-.5 7.6 1.3 10.1.9 1.2 1.9 2.6 3.3 2.5 1.3-.1 1.8-.9 3.4-.9s2 .9 3.4.8c1.4 0 2.3-1.2 3.2-2.5.7-1 1.3-2.1 1.7-3.3-3.3-1.2-3.4-3.7-3.4-3.9zM13.7 4.7c.7-.9 1.2-2.1 1.1-3.3-1 0-2.3.7-3 1.5-.7.8-1.3 2-1.1 3.2 1.1.1 2.3-.6 3-1.4z" />
    </svg>
  );
}
