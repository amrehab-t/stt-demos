import { useState } from "react";
import { ArenaLayout } from "@/components/ArenaLayout";
import { PROVIDERS } from "@/lib/providers";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Loader2, CheckCircle, XCircle, Trash2 } from "lucide-react";
import { useApiKeys } from "@/hooks/useApiKeys";
import { useToast } from "@/hooks/use-toast";
import type { ApiKeyStatus } from "@/lib/types";

function StatusBadge({ status }: { status: ApiKeyStatus }) {
  if (status === "configured") {
    return (
      <Badge variant="outline" className="text-xs border-success text-success">
        <CheckCircle className="h-3 w-3 mr-1" /> Configured
      </Badge>
    );
  }
  if (status === "invalid") {
    return (
      <Badge variant="outline" className="text-xs border-destructive text-destructive">
        <XCircle className="h-3 w-3 mr-1" /> Invalid
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs text-muted-foreground">
      ⚠ Not configured
    </Badge>
  );
}

const SettingsPage = () => {
  const { loading, saveKey, testKey, deleteKey, getStatus } = useApiKeys();
  const { toast } = useToast();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const handleSave = async (providerId: string) => {
    const val = inputs[providerId]?.trim();
    if (!val) return;
    setSaving(providerId);
    try {
      await saveKey(providerId, val);
      setInputs((p) => ({ ...p, [providerId]: "" }));
      toast({ title: "Key saved" });
    } catch (e: any) {
      toast({ title: "Error saving key", description: e.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const handleTest = async (providerId: string) => {
    setTesting(providerId);
    try {
      const unsavedKey = inputs[providerId]?.trim() || undefined;
      const result = await testKey(providerId, unsavedKey);
      if (result.valid) {
        toast({ title: "Key is valid ✓" });
      } else {
        toast({ title: "Key test failed", description: result.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Test error", description: e.message, variant: "destructive" });
    } finally {
      setTesting(null);
    }
  };

  const handleDelete = async (providerId: string) => {
    try {
      await deleteKey(providerId);
      toast({ title: "Key removed" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  return (
    <ArenaLayout>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">API Key Settings</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Enter your API keys for each provider. Keys are stored securely in the database.
        </p>

        <div className="space-y-4">
          {PROVIDERS.map((p) => {
            const status = getStatus(p.id);
            const isSaving = saving === p.id;
            const isTesting = testing === p.id;

            return (
              <Card key={p.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <span className="text-lg">{p.logo}</span>
                      {p.name}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={status} />
                      <a
                        href={p.signupUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Label htmlFor={`key-${p.id}`} className="sr-only">
                        API Key
                      </Label>
                      <Input
                        id={`key-${p.id}`}
                        type="password"
                        placeholder={
                          status === "configured"
                            ? "••••••••  (saved — enter new value to replace)"
                            : `Enter ${p.shortName} API key`
                        }
                        className="text-sm"
                        value={inputs[p.id] || ""}
                        onChange={(e) =>
                          setInputs((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isSaving || !inputs[p.id]?.trim()}
                      onClick={() => handleSave(p.id)}
                    >
                      {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isTesting || (status === "not_configured" && !inputs[p.id]?.trim())}
                      onClick={() => handleTest(p.id)}
                    >
                      {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test"}
                    </Button>
                    {status !== "not_configured" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(p.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">{p.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </ArenaLayout>
  );
};

export default SettingsPage;
