import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Shield } from "lucide-react";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, approved, statusLoading } = useAuth();

  if (loading || statusLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!approved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-md space-y-4">
          <Shield className="h-12 w-12 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-semibold text-foreground">Pending Approval</h2>
          <p className="text-muted-foreground">
            Your account is awaiting admin approval. You'll be able to access the arena once approved.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm text-primary hover:underline"
          >
            Check again
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
