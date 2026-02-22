import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Check, X, Loader2 } from "lucide-react";

interface UserRow {
  user_id: string;
  display_name: string | null;
  email: string;
  approved: boolean;
  created_at: string;
}

const Admin = () => {
  const { user, loading, isAdmin, statusLoading } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [fetching, setFetching] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  const fetchUsers = useCallback(async () => {
    setFetching(true);
    const { data, error } = await supabase.functions.invoke("admin-users", {
      method: "GET",
    });
    if (!error && data?.users) {
      setUsers(data.users);
    }
    setFetching(false);
  }, []);

  useEffect(() => {
    if (isAdmin) fetchUsers();
  }, [isAdmin, fetchUsers]);

  const handleAction = async (userId: string, action: "approve" | "reject") => {
    setActionLoading(userId);
    const { error } = await supabase.functions.invoke("admin-users", {
      method: "POST",
      body: { user_id: userId, action },
    });
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: action === "approve" ? "User approved" : "User rejected" });
      await fetchUsers();
    }
    setActionLoading(null);
  };

  if (loading || statusLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin) return <Navigate to="/arena" replace />;

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto flex items-center h-14 px-4 gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/arena")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">Admin — User Approvals</h1>
        </div>
      </nav>

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {fetching ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">No users found.</p>
        ) : (
          <div className="space-y-3">
            {users.map((u) => (
              <Card key={u.user_id}>
                <CardContent className="flex items-center justify-between py-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">{u.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Joined {new Date(u.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {u.approved ? (
                      <>
                        <Badge variant="secondary" className="bg-green-500/10 text-green-600">
                          Approved
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={actionLoading === u.user_id}
                          onClick={() => handleAction(u.user_id, "reject")}
                        >
                          <X className="h-3 w-3 mr-1" /> Revoke
                        </Button>
                      </>
                    ) : (
                      <>
                        <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-600">
                          Pending
                        </Badge>
                        <Button
                          size="sm"
                          disabled={actionLoading === u.user_id}
                          onClick={() => handleAction(u.user_id, "approve")}
                        >
                          <Check className="h-3 w-3 mr-1" /> Approve
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Admin;
