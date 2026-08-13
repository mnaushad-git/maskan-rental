import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { TopNav } from "@/components/maskan/TopNav";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Home,
  Info,
  PenLine,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/maskan/Badges";
import { useAuth } from "@/lib/auth-context";
import {
  createContract,
  fetchContract,
  fetchContractFlags,
  fetchLead,
  fetchMyContracts,
  signContract,
  type ApiContract,
  type ApiContractFlag,
  type ApiLeadDetail,
} from "@/lib/api/maskan";
import { formatSAR } from "@/lib/maskan-data";
import { useLanguage } from "@/lib/i18n/context";

export const Route = createFileRoute("/contract/$leadId")({
  head: () => ({ meta: [{ title: "Rental Contract — myMakan" }] }),
  component: ContractPage,
});

const TERMINAL_STATUSES = ["active", "expired"];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function plusOneYearISO(fromISO: string) {
  const d = new Date(fromISO);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function ContractPage() {
  const { leadId } = Route.useParams();
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [lead, setLead] = useState<ApiLeadDetail | null>(null);
  const [contract, setContract] = useState<ApiContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [genRent, setGenRent] = useState("");
  const [genDeposit, setGenDeposit] = useState("");
  const [genStart, setGenStart] = useState(todayISO());
  const [genEnd, setGenEnd] = useState(plusOneYearISO(todayISO()));
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState("");

  const [flags, setFlags] = useState<ApiContractFlag[] | null>(null);
  const [flagsLoading, setFlagsLoading] = useState(false);
  const [flagsError, setFlagsError] = useState(false);
  const [districtAvg, setDistrictAvg] = useState<number | null>(null);

  // Load lead + resolve the contract (if one already exists) for this lead
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchLead(Number(leadId)), fetchMyContracts()])
      .then(([l, contracts]) => {
        if (cancelled) return;
        setLead(l);
        const existing = contracts.find((c) => c.lead_id === Number(leadId));
        if (existing) setContract(existing);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [leadId, user]);

  // Poll contract status while it's not yet in a terminal state, so the
  // other party's signature shows up without a manual refresh.
  useEffect(() => {
    if (!contract || TERMINAL_STATUSES.includes(contract.status)) return;
    const interval = setInterval(() => {
      fetchContract(contract.id).then(setContract).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [contract?.id, contract?.status]);

  const loadFlags = (contractId: number) => {
    setFlagsLoading(true);
    setFlagsError(false);
    fetchContractFlags(contractId)
      .then((res) => {
        setFlags(res.flags);
        setDistrictAvg(res.district_avg_monthly_rent);
      })
      .catch(() => setFlagsError(true))
      .finally(() => setFlagsLoading(false));
  };

  useEffect(() => {
    if (contract) loadFlags(contract.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract?.id]);

  useEffect(() => {
    if (lead && !genRent && lead.max_budget) setGenRent(String(lead.max_budget));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setGenError("");
    setGenerating(true);
    try {
      const created = await createContract({
        lead_id: Number(leadId),
        rent_amount: Number(genRent),
        deposit_amount: genDeposit ? Number(genDeposit) : undefined,
        start_date: genStart,
        end_date: genEnd,
      });
      setContract(created);
    } catch {
      setGenError(t("contractPage.generate.error"));
    } finally {
      setGenerating(false);
    }
  }

  async function handleSign() {
    if (!contract) return;
    setSignError("");
    setSigning(true);
    try {
      const updated = await signContract(contract.id);
      setContract(updated);
    } catch {
      setSignError(t("contractPage.signatures.signError"));
    } finally {
      setSigning(false);
    }
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4">
          <h1 className="text-xl font-bold">{t("contractPage.signInToView")}</h1>
          <Button onClick={() => navigate({ to: "/auth" })}>{t("contractPage.signIn")}</Button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <main className="mx-auto max-w-3xl px-6 py-8">
          <Skeleton className="mb-6 h-20 w-full rounded-2xl" />
          <Skeleton className="h-96 w-full rounded-2xl" />
        </main>
      </div>
    );
  }

  if (notFound || !lead) {
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4">
          <p className="text-sm text-muted-foreground">{t("contractPage.leadNotFound")}</p>
          <Button variant="outline" onClick={() => navigate({ to: "/" })}>{t("contractPage.goHome")}</Button>
        </div>
      </div>
    );
  }

  const isTenant = user.id === (contract?.tenant_user_id ?? lead.customer_user_id);

  // No contract yet
  if (!contract) {
    const canGenerate = lead.status === "closed_won" && isTenant;
    return (
      <div className="min-h-screen bg-surface">
        <TopNav />
        <main className="mx-auto max-w-2xl px-6 py-8">
          <Link
            to="/lead/$leadId"
            params={{ leadId }}
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4 rtl:rotate-180" /> {t("contractPage.backToLead")}
          </Link>

          {!canGenerate ? (
            <div className="rounded-2xl border border-dashed border-border p-6 text-center space-y-2">
              <FileText className="size-6 text-primary mx-auto" />
              <p className="text-sm font-medium">{t("contractPage.notReadyTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("contractPage.notReadyDesc")}</p>
            </div>
          ) : (
            <form
              onSubmit={handleGenerate}
              className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-4"
            >
              <div>
                <h2 className="font-semibold flex items-center gap-2">
                  <FileText className="size-4 text-primary" /> {t("contractPage.generate.heading")}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("contractPage.generate.desc")}</p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium space-y-1">
                  <span>{t("contractPage.generate.rentLabel")}</span>
                  <input
                    type="number"
                    required
                    min={1}
                    value={genRent}
                    onChange={(e) => setGenRent(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                  />
                </label>
                <label className="text-xs font-medium space-y-1">
                  <span>{t("contractPage.generate.depositLabel")}</span>
                  <input
                    type="number"
                    min={0}
                    value={genDeposit}
                    onChange={(e) => setGenDeposit(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                  />
                </label>
                <label className="text-xs font-medium space-y-1">
                  <span>{t("contractPage.generate.startLabel")}</span>
                  <input
                    type="date"
                    required
                    value={genStart}
                    onChange={(e) => setGenStart(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                  />
                </label>
                <label className="text-xs font-medium space-y-1">
                  <span>{t("contractPage.generate.endLabel")}</span>
                  <input
                    type="date"
                    required
                    value={genEnd}
                    onChange={(e) => setGenEnd(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                  />
                </label>
              </div>

              {genError && <p className="text-xs text-destructive">{genError}</p>}

              <Button type="submit" disabled={generating || !genRent}>
                {generating ? t("contractPage.generate.submitting") : t("contractPage.generate.submit")}
              </Button>
            </form>
          )}
        </main>
      </div>
    );
  }

  const KNOWN_STATUSES = ["draft", "pending_signature", "active", "expired"] as const;
  const statusKey = (KNOWN_STATUSES as readonly string[]).includes(contract.status)
    ? (contract.status as (typeof KNOWN_STATUSES)[number])
    : "draft";
  const statusLabel = t(`contractPage.statusInfo.${statusKey}.label`);
  const statusDescription = t(`contractPage.statusInfo.${statusKey}.description`);
  const mySigned = isTenant ? !!contract.tenant_signed_at : !!contract.landlord_signed_at;
  const canSign = ["draft", "pending_signature"].includes(contract.status) && !mySigned;

  const severityTone: Record<ApiContractFlag["severity"], "info" | "warning" | "destructive"> = {
    info: "info",
    warning: "warning",
    high: "destructive",
  };
  const severityIcon: Record<ApiContractFlag["severity"], React.ReactNode> = {
    info: <Info className="size-3.5" />,
    warning: <TriangleAlert className="size-3.5" />,
    high: <TriangleAlert className="size-3.5" />,
  };

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <main className="mx-auto max-w-3xl px-6 py-8">
        <Link
          to="/lead/$leadId"
          params={{ leadId }}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" /> {t("contractPage.backToLead")}
        </Link>

        {/* Status banner */}
        <div
          className={`mb-6 rounded-2xl border p-5 ${
            contract.status === "active"
              ? "border-success/30 bg-success/5"
              : contract.status === "expired"
                ? "border-border bg-card"
                : "border-primary/20 bg-primary/5"
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`grid size-9 shrink-0 place-items-center rounded-full ${
                contract.status === "active" ? "bg-success/15 text-success" : "bg-primary/15 text-primary"
              }`}
            >
              {contract.status === "active" ? <CheckCircle2 className="size-5" /> : <FileText className="size-5" />}
            </div>
            <div>
              <h2 className="font-semibold">{statusLabel}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{statusDescription}</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* Terms */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Home className="size-4 text-muted-foreground" /> {t("contractPage.terms.heading")}
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("contractPage.terms.monthlyRent")}</span>
                <span className="font-medium">SAR {formatSAR(contract.rent_amount)}/mo</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("contractPage.terms.deposit")}</span>
                <span className="font-medium">
                  {contract.deposit_amount ? `SAR ${formatSAR(contract.deposit_amount)}` : t("contractPage.terms.noneSet")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("contractPage.terms.duration")}</span>
                <span className="font-medium">{contract.start_date} — {contract.end_date}</span>
              </div>
              {contract.property_title && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("contractPage.terms.property")}</span>
                  <span className="font-medium">{contract.property_title}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("contractPage.terms.tenant")}</span>
                <span className="font-medium">{contract.tenant_name ?? t("contractPage.terms.noneSet")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("contractPage.terms.landlord")}</span>
                <span className="font-medium">{contract.landlord_agency_name ?? t("contractPage.terms.noneSet")}</span>
              </div>
            </div>
          </div>

          {/* AI Contract Assistant */}
          <div className="rounded-2xl border border-ai/20 bg-ai-soft/10 p-5 shadow-card space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Sparkles className="size-4 text-ai" /> {t("contractPage.ai.heading")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("contractPage.ai.desc")}</p>

            {flagsLoading && (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
              </div>
            )}

            {!flagsLoading && flagsError && (
              <div className="space-y-2">
                <p className="text-sm text-destructive">{t("contractPage.ai.error")}</p>
                <Button variant="outline" size="sm" onClick={() => loadFlags(contract.id)}>
                  {t("contractPage.ai.retry")}
                </Button>
              </div>
            )}

            {!flagsLoading && !flagsError && flags && (
              <div className="space-y-2">
                {districtAvg != null && (
                  <p className="text-xs text-muted-foreground">
                    {t("contractPage.ai.districtAvg", { amount: formatSAR(districtAvg) })}
                  </p>
                )}
                {flags.map((f, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card p-3 text-sm">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge tone={severityTone[f.severity]} icon={severityIcon[f.severity]}>
                        {t(`contractPage.ai.severity.${f.severity}`)}
                      </Badge>
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {f.category}
                      </span>
                    </div>
                    <p className="text-foreground">{f.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Signatures */}
          <div className="rounded-2xl border border-border bg-card p-5 shadow-card space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <PenLine className="size-4 text-muted-foreground" /> {t("contractPage.signatures.heading")}
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("contractPage.signatures.tenantSigned")}</span>
                {contract.tenant_signed_at ? (
                  <Badge tone="success" icon={<CheckCircle2 className="size-3.5" />}>
                    {new Date(contract.tenant_signed_at).toLocaleDateString()}
                  </Badge>
                ) : (
                  <Badge tone="neutral">{t("contractPage.signatures.notYetSigned")}</Badge>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("contractPage.signatures.landlordSigned")}</span>
                {contract.landlord_signed_at ? (
                  <Badge tone="success" icon={<CheckCircle2 className="size-3.5" />}>
                    {new Date(contract.landlord_signed_at).toLocaleDateString()}
                  </Badge>
                ) : (
                  <Badge tone="neutral">{t("contractPage.signatures.notYetSigned")}</Badge>
                )}
              </div>
            </div>

            {signError && <p className="text-xs text-destructive">{signError}</p>}

            {canSign ? (
              <Button onClick={handleSign} disabled={signing}>
                {signing
                  ? t("contractPage.signatures.signing")
                  : isTenant
                    ? t("contractPage.signatures.signAsTenant")
                    : t("contractPage.signatures.signAsLandlord")}
              </Button>
            ) : contract.status === "active" ? (
              <p className="text-sm text-success">{t("contractPage.signatures.contractActive")}</p>
            ) : mySigned ? (
              <p className="text-sm text-muted-foreground">{t("contractPage.signatures.waitingOtherParty")}</p>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
