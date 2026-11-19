import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { TopNav } from "@/components/maskan/TopNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth-context";
import {
  deleteMyAccount,
  fetchAccountDeletionEligibility,
  login,
  type AccountDeletionEligibility,
  type AuthUser,
} from "@/lib/api/maskan";

/**
 * Public account-deletion page — the "web link" Google Play requires for apps
 * that let users create accounts. Works for anyone who can sign in; deletion
 * itself is the same re-authenticated API the Android app uses
 * (POST /api/auth/me/delete, see backend app/services/account_deletion.py).
 *
 * English only, like the privacy policy, until a reviewed Arabic version exists.
 */
export const Route = createFileRoute("/account/delete")({
  head: () => ({
    meta: [
      { title: "Delete your Maskan account" },
      {
        name: "description",
        content: "How to delete your Maskan account and what happens to your data.",
      },
    ],
  }),
  component: DeleteAccountPage,
});

const CONFIRMATION_WORD = "DELETE";
// Pending business decision (D1 in docs/releases/maskan-android-google-play.md).
// The "can't sign in" fallback stays hidden until a support address is set, so
// no unresolved placeholder is ever shown publicly.
const SUPPORT_EMAIL = "";

function DeleteAccountPage() {
  const { user, setAuth, clearAuth } = useAuth();
  const [deleted, setDeleted] = useState(false);

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <main className="container-page max-w-2xl py-12">
        <article
          dir="ltr"
          lang="en"
          className="space-y-6 rounded-2xl border border-border bg-card p-6 text-sm leading-relaxed shadow-card sm:p-8"
        >
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Delete your Maskan account
          </h1>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">How to delete your account</h2>
            <ul className="list-disc space-y-1 ps-5">
              <li>
                In the Maskan Android app: open <strong>Profile</strong> and tap{" "}
                <strong>Delete account</strong>.
              </li>
              <li>On the web: sign in below and follow the steps on this page.</li>
              {SUPPORT_EMAIL && (
                <li>
                  Can't sign in? Email{" "}
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    {SUPPORT_EMAIL}
                  </a>{" "}
                  from the email address registered to your account.
                </li>
              )}
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">What happens to your data</h2>
            <p>
              <strong>Deleted:</strong> your name, email address and phone number on your profile,
              saved properties and searches, search history, notifications and notification
              settings, registered devices and financing enquiries. You are signed out everywhere
              and can't sign in to the account again.
            </p>
            <p>
              <strong>Kept:</strong> records we may need for legal, tax or dispute purposes —
              completed or cancelled transactions, bookings, contracts, payments, offers, viewings
              and their documents — are retained but no longer linked to an active account. Reviews
              you wrote stay visible without your name. See the{" "}
              <Link to="/privacy" className="font-semibold text-primary hover:underline">
                privacy policy
              </Link>{" "}
              for details and retention periods.
            </p>
          </section>

          {deleted ? (
            <div
              className="flex items-start gap-3 rounded-xl border border-border p-4"
              role="status"
            >
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
              <p>Your account has been deleted and you have been signed out.</p>
            </div>
          ) : user ? (
            <DeletionForm
              email={user.email}
              onDeleted={() => {
                clearAuth();
                setDeleted(true);
              }}
            />
          ) : (
            <SignInForm onSignedIn={(u, token) => setAuth(u, token)} />
          )}
        </article>
      </main>
    </div>
  );
}

function SignInForm({ onSignedIn }: { onSignedIn: (user: AuthUser, token: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await login({ email, password });
      onSignedIn(res.user, res.access_token);
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : "";
      setError(
        msg.includes("too many")
          ? "Too many attempts. Please wait and try again."
          : "Invalid email or password.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-border p-4">
      <h2 className="text-lg font-semibold">Sign in to continue</h2>
      <div className="space-y-1">
        <Label htmlFor="del-email">Email</Label>
        <Input
          id="del-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="del-password">Password</Label>
        <Input
          id="del-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" disabled={loading || !email || !password}>
        {loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

function DeletionForm({ email, onDeleted }: { email: string; onDeleted: () => void }) {
  const [eligibility, setEligibility] = useState<AccountDeletionEligibility | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setEligibility(await fetchAccountDeletionEligibility());
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Couldn't check your account. Please try again.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmed = confirmation.trim().toUpperCase() === CONFIRMATION_WORD;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!confirmed) return;
    if (!window.confirm("Delete your Maskan account permanently? This can't be undone.")) return;
    setError(null);
    setSubmitting(true);
    try {
      await deleteMyAccount(password, confirmation.trim());
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      void load();
    } finally {
      setSubmitting(false);
      setPassword("");
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-destructive/30 p-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <AlertTriangle className="size-5 text-destructive" /> Delete account for {email}
      </h2>

      {!eligibility && !loadError && (
        <p className="text-muted-foreground">Checking your account…</p>
      )}
      {loadError && (
        <div className="space-y-2">
          <p className="text-destructive" role="alert">
            {loadError}
          </p>
          <Button variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      )}

      {eligibility && !eligibility.eligible && (
        <div role="alert" className="space-y-1">
          <p className="font-semibold">You can't delete your account yet:</p>
          <ul className="list-disc space-y-1 ps-5">
            {eligibility.blockers.map((b) => (
              <li key={b.code}>{b.message}</li>
            ))}
          </ul>
        </div>
      )}

      {eligibility?.eligible && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="del-confirm-password">Current password</Label>
            <Input
              id="del-confirm-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="del-confirm-word">Type {CONFIRMATION_WORD} to confirm</Label>
            <Input
              id="del-confirm-word"
              autoComplete="off"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={CONFIRMATION_WORD}
              required
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="destructive"
            disabled={submitting || !password || !confirmed}
          >
            {submitting ? "Deleting…" : "Delete my account"}
          </Button>
        </form>
      )}
    </section>
  );
}
