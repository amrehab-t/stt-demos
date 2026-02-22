import { useState } from "react";
import { PROVIDERS } from "@/lib/providers";
import { ArenaLayout } from "@/components/ArenaLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const COLORS = ["hsl(220,72%,50%)", "hsl(142,72%,39%)", "hsl(38,92%,50%)", "hsl(0,84%,60%)", "hsl(270,60%,50%)"];

const Benchmarks = () => {
  const [minutes, setMinutes] = useState(10);

  // Parse cost per minute for chart data
  const chartData = PROVIDERS.map((p) => {
    const costStr = p.costPerMinute?.replace("$", "") || "0";
    const cost = parseFloat(costStr) || 0;
    return { name: p.shortName, cost, logo: p.logo };
  });

  const latencyData = PROVIDERS.map((p) => {
    // Extract avg latency from range string like "200-400ms"
    const match = p.latencyRange?.match(/(\d+)/g);
    const avg = match ? (parseInt(match[0]) + (parseInt(match[1]) || parseInt(match[0]))) / 2 : 0;
    return { name: p.shortName, latency: avg, logo: p.logo };
  });

  return (
    <ArenaLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">Provider Benchmarks</h1>

        {/* Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Estimated Latency (ms)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={latencyData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="latency" radius={[4, 4, 0, 0]}>
                    {latencyData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Cost per Minute ($)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Cost calculator */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Cost Calculator</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 mb-4">
              <Label htmlFor="minutes" className="text-sm whitespace-nowrap">Audio minutes:</Label>
              <Input
                id="minutes"
                type="number"
                min={1}
                max={10000}
                value={minutes}
                onChange={(e) => setMinutes(parseInt(e.target.value) || 1)}
                className="w-24 h-8 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {PROVIDERS.map((p) => {
                const costStr = p.costPerMinute?.replace("$", "") || "0";
                const cost = parseFloat(costStr) || 0;
                const total = (cost * minutes).toFixed(2);
                return (
                  <div key={p.id} className="rounded-md border p-3 text-center">
                    <p className="text-lg mb-1">{p.logo}</p>
                    <p className="text-xs text-muted-foreground">{p.shortName}</p>
                    <p className="text-lg font-semibold font-mono mt-1">${total}</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Comparison table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Feature Comparison</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Cost / min</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>Languages</TableHead>
                  <TableHead>Key Features</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PROVIDERS.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.logo} {p.name}</TableCell>
                    <TableCell className="font-mono text-sm">{p.costPerMinute ?? "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{p.latencyRange ?? "—"}</TableCell>
                    <TableCell>{p.supportedLanguages.length}+</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.features?.join(", ") ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ArenaLayout>
  );
};

export default Benchmarks;
