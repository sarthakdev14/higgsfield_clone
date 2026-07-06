import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { deleteAvatar, fetchAvatars, type Avatar } from "@/lib/api";
import { AvatarForm } from "@/components/AvatarForm";
import { MyAvatars } from "@/components/MyAvatars";
import { SignedOut } from "@/components/SignedOut";

export function AvatarPage() {
  const { data: session, isPending } = useSession();
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAvatars = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchAvatars()
      .then(setAvatars)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (session?.user) loadAvatars();
  }, [session?.user, loadAvatars]);

  async function handleDelete(id: string) {
    setAvatars((prev) => prev.filter((a) => a.id !== id));
    try {
      await deleteAvatar(id);
    } catch {
      loadAvatars();
    }
  }

  if (isPending) return null;
  if (!session?.user) return <SignedOut />;

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-6">
      {/* Tab bar */}
      <div className="mb-5 flex items-center justify-between gap-3">
        <button className="border-b-2 border-primary px-1 pb-2 text-sm font-semibold text-foreground">
          Create Avatar
        </button>
        <span className="text-sm text-muted-foreground">
          {avatars.length} {avatars.length === 1 ? "avatar" : "avatars"}
        </span>
      </div>

      {/* Two-column workspace */}
      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="w-full shrink-0 lg:w-[340px]">
          <div className="lg:sticky lg:top-20">
            <AvatarForm onCreated={(avatar) => setAvatars((prev) => [avatar, ...prev])} />
          </div>
        </aside>

        <main className="min-h-[60vh] flex-1 overflow-hidden rounded-2xl border border-white/[0.08] bg-card/40 p-6">
          <h2 className="mb-4 text-lg font-semibold">My avatars</h2>
          <MyAvatars avatars={avatars} loading={loading} error={error} onDelete={handleDelete} />
        </main>
      </div>
    </div>
  );
}
