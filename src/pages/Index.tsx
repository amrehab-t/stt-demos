import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PROVIDERS } from "@/lib/providers";
import { Mic, Upload, Zap, BarChart3, Globe, Shield } from "lucide-react";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold tracking-tight text-foreground">
              STT Arena
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              beta
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/auth")}>
              Sign in
            </Button>
            <Button size="sm" onClick={() => navigate("/auth?tab=signup")}>
              Get started
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="container mx-auto px-4 pt-20 pb-16 text-center">
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-foreground max-w-3xl mx-auto leading-[1.1]">
          Benchmark Speech-to-Text APIs{" "}
          <span className="text-primary">side by side</span>
        </h1>
        <p className="mt-5 text-lg text-muted-foreground max-w-xl mx-auto">
          Compare 5 leading STT providers in real-time and async modes.
          Pick any 4, speak or upload, see results instantly.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button
            size="lg"
            className="gap-2 px-8 h-12 text-base"
            onClick={() => navigate("/arena")}
          >
            <Mic className="h-5 w-5" />
            Real-Time Arena
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="gap-2 px-8 h-12 text-base"
            onClick={() => navigate("/batch")}
          >
            <Upload className="h-5 w-5" />
            Async Batch
          </Button>
        </div>
      </section>

      {/* Provider Logos */}
      <section className="container mx-auto px-4 pb-16">
        <p className="text-center text-sm text-muted-foreground mb-6">
          Supports all major providers
        </p>
        <div className="flex flex-wrap items-center justify-center gap-6">
          {PROVIDERS.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-card border border-border"
            >
              <span className="text-xl">{p.logo}</span>
              <span className="text-sm font-medium text-foreground">
                {p.shortName}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-4 pb-20">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {[
            {
              icon: Zap,
              title: "Live Latency Tracking",
              desc: "See per-chunk latency badges for every provider in real-time.",
            },
            {
              icon: BarChart3,
              title: "Side-by-Side Comparison",
              desc: "2×2 grid layout lets you compare up to 4 providers simultaneously.",
            },
            {
              icon: Globe,
              title: "Multi-Language",
              desc: "Test transcription across 13+ languages with any provider.",
            },
            {
              icon: Shield,
              title: "Secure Key Storage",
              desc: "API keys encrypted per user, never exposed client-side.",
            },
            {
              icon: Upload,
              title: "Batch Processing",
              desc: "Upload audio files and process with multiple providers at once.",
            },
            {
              icon: Mic,
              title: "Browser Mic Capture",
              desc: "PCM 16-bit 16kHz mono — broadcast to all providers simultaneously.",
            },
          ].map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="rounded-lg border border-border bg-card p-6"
            >
              <Icon className="h-5 w-5 text-primary mb-3" />
              <h3 className="font-semibold text-foreground mb-1">{title}</h3>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <p className="text-center text-sm text-muted-foreground">
          STT Arena — Compare speech-to-text providers
        </p>
      </footer>
    </div>
  );
};

export default Index;
