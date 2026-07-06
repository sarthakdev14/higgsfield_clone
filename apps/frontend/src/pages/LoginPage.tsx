import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { AuthForm } from "@/components/AuthForm";
import { useSession } from "@/lib/auth-client";

export function LoginPage() {
  const { data: session } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (session?.user) navigate("/", { replace: true });
  }, [session?.user, navigate]);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md items-center px-4">
      <Card className="w-full">
        <CardContent className="pt-6">
          <AuthForm onSuccess={() => navigate("/", { replace: true })} />
        </CardContent>
      </Card>
    </div>
  );
}
