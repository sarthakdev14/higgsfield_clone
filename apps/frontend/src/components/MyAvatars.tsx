import { Loader2, Trash2, User } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Avatar } from "@/lib/api";

interface Props {
  avatars: Avatar[];
  loading: boolean;
  error: string | null;
  onDelete: (id: string) => void;
}

export function MyAvatars({ avatars, loading, error, onDelete }: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your avatars…
      </div>
    );
  }
  if (error) return <p className="py-16 text-center text-destructive">{error}</p>;
  if (avatars.length === 0) {
    return (
      <p className="py-16 text-center text-muted-foreground">
        No avatars yet. Create one above to use it in templates.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {avatars.map((avatar) => (
        <Card
          key={avatar.id}
          className="group overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-white/15 hover:shadow-xl hover:shadow-black/40"
        >
          <div className="aspect-square overflow-hidden bg-black/40">
            {avatar.faceUrl ? (
              <img
                src={avatar.faceUrl}
                alt={avatar.name}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <User className="h-8 w-8" />
              </div>
            )}
          </div>
          <CardContent className="flex items-center justify-between gap-2 p-3">
            <span className="line-clamp-1 text-sm font-medium">{avatar.name}</span>
            <Button
              variant="ghost"
              size="icon"
              title="Delete avatar"
              onClick={() => onDelete(avatar.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
