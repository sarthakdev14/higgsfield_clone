import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { fetchFaceSwaps, type FaceSwap } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FaceSwapForm } from "@/components/FaceSwapForm";
import { MyFaceSwaps } from "@/components/MyFaceSwaps";
import { SignedOut } from "@/components/SignedOut";
import { PageHeader } from "@/components/PageHeader";

export function FaceSwapPage() {
  const { data: session, isPending } = useSession();
  const [tab, setTab] = useState("create");
  const [swaps, setSwaps] = useState<FaceSwap[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSwaps = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchFaceSwaps()
      .then(setSwaps)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (session?.user) loadSwaps();
  }, [session?.user, loadSwaps]);

  if (isPending) return null;
  if (!session?.user) return <SignedOut />;

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:py-10">
      <PageHeader
        eyebrow="Face swap"
        title="Create personalized image variations in seconds."
        description="Upload a base image and a face source, then save the generated swaps in a cleaner, easier-to-scan library."
      />
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="rounded-3xl border border-white/[0.08] bg-card/50 p-4 shadow-xl shadow-black/20 backdrop-blur-xl sm:p-6"
      >
        <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl border border-white/[0.06] bg-white/[0.03] p-1 sm:w-auto">
          <TabsTrigger value="create">Create</TabsTrigger>
          <TabsTrigger value="library" onClick={loadSwaps}>
            My Swaps
          </TabsTrigger>
        </TabsList>

        <TabsContent value="create">
          <FaceSwapForm
            onCreated={(swap) => {
              setSwaps((prev) => [swap, ...prev]);
              setTab("library");
            }}
          />
        </TabsContent>

        <TabsContent value="library">
          <MyFaceSwaps swaps={swaps} loading={loading} error={error} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
