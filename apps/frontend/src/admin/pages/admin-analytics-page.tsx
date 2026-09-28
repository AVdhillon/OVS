import { ChartSkeleton } from "../../app/components/loading-skeletons";
import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../app/components/ui/card";
import { Button } from "../../app/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../../app/components/ui/tabs";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "../../app/components/ui/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { AdminHeader } from "../components/admin-header";
import {
  adminApi,
  type AnalyticsInterval,
  type AnalyticsMetric,
  type AnalyticsSeries,
  type AnalyticsSummary,
} from "../lib/admin-api";
import { BarChart3 } from "lucide-react";

// Platform analytics: orgs-by-status over time, active/completed events and
// ballots cast — counts only, never anything vote-identifying. Reads both of
// AnalyticsAdminController's routes: /admin/analytics/summary for the
// headline cards and /admin/analytics/series for the chart.
//
// Charting uses the repo's existing shadcn `ui/chart.tsx` wrapper over
// recharts (both already in package.json) rather than adding a dependency
// or hand-rolling SVG. This page is the wrapper's only consumer, so an
// "remove unused components" cleanup must not delete it.
//
// **Nothing on this page can be filtered to an organization or an event.**
// There is no orgid control here and the backend exposes no parameter for
// one — a per-org or per-event ballot count is turnout, which belongs to an
// organizer's own results view, not a platform dashboard. See
// analytics.service.ts's privacy note; this page is deliberately the dumb
// end of that arrangement, with no way to ask for more than it's given.

const METRIC_TABS: Array<{
  key: AnalyticsMetric;
  label: string;
  description: string;
}> = [
  {
    key: "organizations",
    label: "Organizations",
    description:
      "Organizations registered in each period, coloured by the status they hold today.",
  },
  {
    key: "org_requests",
    label: "Requests",
    description:
      "Organization requests submitted in each period, coloured by how they were resolved.",
  },
  {
    key: "events",
    label: "Events",
    description:
      "Events created in each period, coloured by the status they hold today.",
  },
  {
    key: "ballots",
    label: "Ballots",
    description:
      "Ballots cast in each period. A count only — no breakdown by organization, event or candidate is available here.",
  },
  {
    key: "accounts",
    label: "Accounts",
    description: "Accounts created in each period.",
  },
];

const INTERVALS: Array<{ key: AnalyticsInterval; label: string }> = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
];

// Status colours reuse the palette the org pages already established
// (emerald = healthy/approved, amber = paused/needs attention, slate =
// retired, red = refused/cancelled) so a status means the same thing
// wherever an admin sees it.
const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "#059669",
  SUSPENDED: "#d97706",
  ARCHIVED: "#64748b",
  PENDING: "#0284c7",
  NEEDS_INFO: "#d97706",
  APPROVED: "#059669",
  REJECTED: "#dc2626",
  COMPLETED: "#0284c7",
  CANCELLED: "#dc2626",
  total: "#0284c7",
};

function statusLabel(status: string) {
  return status
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Buckets arrive as the timestamp Postgres' date_trunc() produced, so they
 * are already aligned to the interval — this only chooses how much of it to
 * show. Weeks are labelled with their (Monday) start date rather than a
 * week number, which nobody reads at a glance.
 */
function bucketLabel(iso: string, interval: AnalyticsInterval) {
  const d = new Date(iso);
  if (interval === "month") {
    return d.toLocaleDateString(undefined, { year: "2-digit", month: "short" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | string;
  detail?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
        {detail && (
          <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminAnalyticsPage() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [metric, setMetric] = useState<AnalyticsMetric>("organizations");
  const [interval, setInterval] = useState<AnalyticsInterval>("month");
  const [series, setSeries] = useState<AnalyticsSeries | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .getAnalyticsSummary()
      .then(setSummary)
      .catch((e: any) =>
        setSummaryError(e?.message ?? "Failed to load platform totals"),
      );
  }, []);

  const loadSeries = useCallback(async () => {
    setSeriesLoading(true);
    setSeriesError(null);
    try {
      // No `from`/`to` passed — the server's bounded default (last 12
      // months) is deliberate and this page doesn't widen it.
      setSeries(await adminApi.getAnalyticsSeries({ metric, interval }));
    } catch (e: any) {
      setSeriesError(e?.message ?? "Failed to load the series");
      setSeries(null);
    } finally {
      setSeriesLoading(false);
    }
  }, [metric, interval]);

  useEffect(() => {
    loadSeries();
  }, [loadSeries]);

  const activeMetric =
    METRIC_TABS.find((m) => m.key === metric) ?? METRIC_TABS[0];

  // Recharts wants one flat object per bucket with a key per stacked
  // series. Breakdown metrics get one key per status; the two count-only
  // metrics get a single `total` key, which is also why the legend
  // disappears for them rather than showing a one-item legend.
  const seriesKeys = series?.statuses ?? ["total"];
  const chartData =
    series?.points.map((p) => ({
      label: bucketLabel(p.bucket, series.interval),
      ...(series.statuses
        ? Object.fromEntries(
            series.statuses.map((s) => [s, p.by_status?.[s] ?? 0]),
          )
        : { total: p.total }),
    })) ?? [];

  const chartConfig: ChartConfig = Object.fromEntries(
    seriesKeys.map((key) => [
      key,
      {
        label: key === "total" ? activeMetric.label : statusLabel(key),
        color: STATUS_COLOR[key] ?? "#64748b",
      },
    ]),
  );

  return (
    <div className="min-h-dvh bg-muted/30">
      <AdminHeader />
      <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-semibold">Platform analytics</h1>
          <p className="text-sm text-muted-foreground">
            Aggregate activity across the whole platform. Counts only —
            nothing here identifies an individual voter or reveals how any
            event turned out.
          </p>
        </div>

        {summaryError && (
          <p className="text-sm text-destructive">{summaryError}</p>
        )}

        {summary && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              label="Organizations"
              value={summary.organizations.total}
              detail={
                <>
                  {summary.organizations.by_status.ACTIVE ?? 0} active ·{" "}
                  {summary.organizations.by_status.SUSPENDED ?? 0} suspended ·{" "}
                  {summary.organizations.by_status.ARCHIVED ?? 0} archived
                </>
              }
            />
            <SummaryCard
              label="Open requests"
              value={summary.org_requests.open}
              detail={
                <>
                  of {summary.org_requests.total} ever submitted ·{" "}
                  <Link to="/requests" className="underline underline-offset-2">
                    Review queue
                  </Link>
                </>
              }
            />
            <SummaryCard
              label="Events"
              value={summary.events.total}
              detail={
                <>
                  {summary.events.by_status.ACTIVE ?? 0} active ·{" "}
                  {summary.events.by_status.COMPLETED ?? 0} completed ·{" "}
                  {summary.events.by_status.CANCELLED ?? 0} cancelled
                </>
              }
            />
            <SummaryCard
              label="Ballots cast"
              value={summary.ballots_cast.toLocaleString()}
              detail="Across every event, all time"
            />
            <SummaryCard label="Accounts" value={summary.accounts} />
            <SummaryCard
              label="Org memberships"
              value={summary.org_memberships}
            />
            <SummaryCard
              label="Active site admins"
              value={summary.active_site_admins}
            />
          </div>
        )}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Over time</CardTitle>
                <CardDescription>{activeMetric.description}</CardDescription>
              </div>
              <Tabs
                value={interval}
                onValueChange={(v) => setInterval(v as AnalyticsInterval)}
              >
                <TabsList>
                  {INTERVALS.map((i) => (
                    <TabsTrigger key={i.key} value={i.key}>
                      {i.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
            <div className="flex flex-wrap gap-1 pt-2">
              {METRIC_TABS.map((m) => (
                <Button
                  key={m.key}
                  size="sm"
                  variant={metric === m.key ? "default" : "outline"}
                  onClick={() => setMetric(m.key)}
                >
                  {m.label}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {seriesError && (
              <p className="mb-4 text-sm text-destructive">{seriesError}</p>
            )}

            {seriesLoading ? (
              <ChartSkeleton />
            ) : !series || series.total === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                <BarChart3 className="size-8" />
                <p className="text-sm">
                  Nothing recorded in this window yet.
                </p>
              </div>
            ) : (
              <>
                {/* ChartContainer supplies its own ResponsiveContainer
                    around whatever it's given (see ui/chart.tsx), so the
                    BarChart is its direct child — wrapping it in a second
                    ResponsiveContainer here would nest one inside the other
                    and break recharts' sizing. `aspect-auto` overrides that
                    component's default `aspect-video` so the explicit
                    height below is what actually applies. */}
                <ChartContainer
                  config={chartConfig}
                  className="aspect-auto h-72 w-full"
                >
                  <BarChart data={chartData}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      // A daily series over a long window produces more
                      // ticks than fit; recharts drops overlapping labels
                      // itself, so the bars stay accurate either way.
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={32}
                      allowDecimals={false}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {series.statuses && (
                      <ChartLegend content={<ChartLegendContent />} />
                    )}
                    {seriesKeys.map((key) => (
                      <Bar
                        key={key}
                        dataKey={key}
                        // One stackId for every series, so a breakdown
                        // metric reads as "how many appeared this period,
                        // split by status" rather than as separate bars
                        // an admin has to add up by eye.
                        stackId="a"
                        fill={STATUS_COLOR[key] ?? "#64748b"}
                        radius={key === seriesKeys[seriesKeys.length - 1]
                          ? [3, 3, 0, 0]
                          : 0}
                      />
                    ))}
                  </BarChart>
                </ChartContainer>

                <p className="mt-3 text-xs text-muted-foreground">
                  {series.total.toLocaleString()} total over the last 12
                  months, {series.interval} buckets.
                  {series.statuses && (
                    <>
                      {" "}
                      Colours show each row&apos;s <em>current</em> status,
                      not the status it held during that period — a record
                      whose status changed later appears under its status
                      today, in the period it was first created.
                    </>
                  )}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
