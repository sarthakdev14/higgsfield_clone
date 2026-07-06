import { useCallback, useEffect, useState } from "react";
import { Check, Coins, Loader2, Sparkles } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import {
  fetchCreditPacks,
  fetchCredits,
  startCheckout,
  verifyPayment,
  type CreditBalance,
  type CreditPacksResponse,
  type CreditTransaction,
} from "@/lib/api";
import { openRazorpayCheckout } from "@/lib/razorpay";
import { refreshCredits } from "@/lib/useMe";
import { PageHeader } from "@/components/PageHeader";
import { SignedOut } from "@/components/SignedOut";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const txnLabel: Record<CreditTransaction["type"], string> = {
  PURCHASE: "Purchase",
  SPEND: "Spent",
  REFUND: "Refund",
  BONUS: "Bonus",
  ADJUSTMENT: "Adjustment",
};

export function BillingPage() {
  const { data: session, isPending } = useSession();
  const [packs, setPacks] = useState<CreditPacksResponse | null>(null);
  const [credits, setCredits] = useState<CreditBalance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([fetchCreditPacks(), fetchCredits()])
      .then(([p, c]) => {
        setPacks(p);
        setCredits(c);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (session?.user) load();
  }, [session?.user, load]);

  const buy = useCallback(
    async (packId: string) => {
      if (!packs?.razorpayConfigured) return;
      setBuying(packId);
      setError(null);
      setNotice(null);
      try {
        const order = await startCheckout(packId);
        await openRazorpayCheckout({
          key: order.razorpayKeyId,
          amount: order.amount,
          currency: order.currency,
          name: "Pixovid",
          description: `${order.packName} — ${order.credits} credits`,
          order_id: order.orderId,
          prefill: { email: session?.user?.email, name: session?.user?.name ?? undefined },
          theme: { color: "#6d28d9" },
          modal: { ondismiss: () => setBuying(null) },
          handler: async (resp) => {
            try {
              await verifyPayment(resp);
              setNotice(`Added ${order.credits} credits to your balance.`);
              refreshCredits();
              load();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Payment verification failed.");
            } finally {
              setBuying(null);
            }
          },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start checkout.");
        setBuying(null);
      }
    },
    [packs, session?.user, load],
  );

  if (isPending) return null;
  if (!session?.user) return <SignedOut />;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:py-10">
      <PageHeader
        eyebrow="Billing"
        title="Top up your credits."
        description="Buy credits and spend them on video, image and template-render generations. Credits are refunded automatically if a generation fails."
      >
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 backdrop-blur">
          <Coins className="h-6 w-6 text-brand" />
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Balance</p>
            <p className="text-2xl font-semibold">
              {credits ? credits.balance.toLocaleString() : "—"}
              <span className="ml-1 text-sm font-normal text-muted-foreground">credits</span>
            </p>
          </div>
        </div>
      </PageHeader>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {packs && !packs.razorpayConfigured && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Payments are not configured on this server. Set <code>RAZORPAY_KEY_ID</code> and{" "}
          <code>RAZORPAY_KEY_SECRET</code> in the backend environment to enable purchases.
        </div>
      )}

      {/* What each action costs */}
      {packs && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: "Video generation", cost: packs.actionCosts.video },
            { label: "Image generation", cost: packs.actionCosts.image },
            { label: "Template render", cost: packs.actionCosts.template_render },
          ].map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm"
            >
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-medium">{row.cost} credits</span>
            </div>
          ))}
        </div>
      )}

      {/* Packs */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {packs?.packs.map((pack, i) => (
          <Card
            key={pack.id}
            className={i === 1 ? "border-brand/40 ring-1 ring-brand/30" : undefined}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{pack.name}</CardTitle>
                {i === 1 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand/20 px-2.5 py-0.5 text-[0.7rem] font-semibold text-brand">
                    <Sparkles className="h-3 w-3" /> Popular
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{pack.description}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-3xl font-semibold">₹{pack.priceInr.toLocaleString()}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {pack.credits.toLocaleString()} credits
                  {pack.bonusCredits > 0 && (
                    <span className="ml-1 text-brand">
                      ({pack.baseCredits.toLocaleString()} + {pack.bonusCredits.toLocaleString()} bonus)
                    </span>
                  )}
                </p>
              </div>
              <Button
                className="w-full rounded-full"
                disabled={!packs.razorpayConfigured || buying !== null}
                onClick={() => buy(pack.id)}
              >
                {buying === pack.id ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Processing…
                  </>
                ) : (
                  <>Buy {pack.name}</>
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Transaction history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && !credits ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : credits && credits.transactions.length > 0 ? (
            <ul className="divide-y divide-white/[0.06]">
              {credits.transactions.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.description ?? txnLabel[t.type]}</p>
                    <p className="text-xs text-muted-foreground">
                      {txnLabel[t.type]} · {new Date(t.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={
                      t.amount >= 0
                        ? "shrink-0 font-medium text-emerald-400"
                        : "shrink-0 font-medium text-muted-foreground"
                    }
                  >
                    {t.amount >= 0 ? "+" : ""}
                    {t.amount.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Check className="h-4 w-4" /> No transactions yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
