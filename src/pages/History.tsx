import { useState, useEffect } from "react";
import { ArenaLayout } from "@/components/ArenaLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PROVIDERS } from "@/lib/providers";
import { useToast } from "@/hooks/use-toast";

interface SessionRow {
  id: string;
  mode: string;
  language: string;
  started_at: string;
  ended_at: string | null;
}

interface ResultRow {
  id: string;
  session_id: string;
  provider_id: string;
  panel_index: number;
  transcript: string | null;
  status: string;
  processing_time_ms: number | null;
  word_count: number | null;
  latency_ms: any;
  error: string | null;
}

const History = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [results, setResults] = useState<Record<string, ResultRow[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    fetchSessions();
  }, [user]);

  const fetchSessions = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("sessions")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(50);
    setSessions(data || []);
    setLoading(false);
  };

  const fetchResults = async (sessionId: string) => {
    if (results[sessionId]) return;
    const { data } = await supabase
      .from("session_results")
      .select("*")
      .eq("session_id", sessionId);
    setResults((prev) => ({ ...prev, [sessionId]: data || [] }));
  };

  const toggleExpand = (sessionId: string) => {
    if (expanded === sessionId) {
      setExpanded(null);
    } else {
      setExpanded(sessionId);
      fetchResults(sessionId);
    }
  };

  const handleExport = (session: SessionRow, sessionResults: ResultRow[]) => {
    const exportData = {
      session: { id: session.id, mode: session.mode, language: session.language, startedAt: session.started_at, endedAt: session.ended_at },
      results: sessionResults.map((r) => ({
        provider: r.provider_id,
        transcript: r.transcript,
        wordCount: r.word_count,
        processingTimeMs: r.processing_time_ms,
        status: r.status,
      })),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-${session.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (sessionId: string) => {
    // Results have FK cascade, but no cascade defined — delete results first
    await supabase.from("session_results").delete().eq("session_id", sessionId);
    await supabase.from("sessions").delete().eq("id", sessionId);
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    toast({ title: "Session deleted" });
  };

  return (
    <ArenaLayout>
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Session History</h1>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sessions yet. Start recording in the Arena or process a file in Batch mode.</p>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => {
              const isExpanded = expanded === session.id;
              const sessionResults = results[session.id] || [];

              return (
                <Card key={session.id}>
                  <CardHeader className="pb-2 cursor-pointer" onClick={() => toggleExpand(session.id)}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CardTitle className="text-sm font-medium">
                          {new Date(session.started_at).toLocaleString()}
                        </CardTitle>
                        <Badge variant={session.mode === "realtime" ? "default" : "secondary"} className="text-[10px]">
                          {session.mode === "realtime" ? "Real-time" : "Async"}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">{session.language}</Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </div>
                  </CardHeader>

                  {isExpanded && (
                    <CardContent>
                      {sessionResults.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No results for this session.</p>
                      ) : (
                        <div className="space-y-3">
                          {sessionResults.map((r) => {
                            const provider = PROVIDERS.find((p) => p.id === r.provider_id);
                            return (
                              <div key={r.id} className="border rounded-md p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-sm font-medium">
                                    {provider?.logo} {provider?.shortName ?? r.provider_id}
                                  </span>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    {r.word_count != null && <span>{r.word_count} words</span>}
                                    {r.processing_time_ms != null && <span>{r.processing_time_ms}ms</span>}
                                    <Badge variant={r.status === "done" ? "secondary" : "destructive"} className="text-[10px]">
                                      {r.status}
                                    </Badge>
                                  </div>
                                </div>
                                <p className="text-sm text-foreground whitespace-pre-wrap">
                                  {r.transcript || <span className="text-muted-foreground italic">No transcript</span>}
                                </p>
                                {r.error && <p className="text-xs text-destructive mt-1">{r.error}</p>}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="flex gap-2 mt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1 text-xs"
                          onClick={() => handleExport(session, sessionResults)}
                        >
                          <Download className="h-3 w-3" /> Export JSON
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-xs text-destructive hover:text-destructive"
                          onClick={() => handleDelete(session.id)}
                        >
                          <Trash2 className="h-3 w-3" /> Delete
                        </Button>
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </ArenaLayout>
  );
};

export default History;
