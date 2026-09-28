import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../app/components/ui/card";
import { Badge } from "../../app/components/ui/badge";
import { Button } from "../../app/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../../app/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "../../app/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../app/components/ui/select";
import { AdminHeader } from "../components/admin-header";
import {
  adminApi,
  type AdminReviewQueueRow,
  type AdminReviewQueueRequestType,
} from "../lib/admin-api";
import { ChevronLeft, ChevronRight, Inbox, Clock } from "lucide-react";
import { Link } from "react-router";

// Reads GET /admin/org-requests — a review queue, not a public list, so it
// defaults to the same open-only view the backend itself defaults to
// (PENDING + NEEDS_INFO) rather than re-deciding that here; the "Open"
// tab passes no `status` param at all for exactly that reason (see
// STATUS_TABS below), so the frontend's idea of "open" can never drift
// from the backend's.
//
// Reads GET /admin/review-queue rather than GET /admin/org-requests
// alone, so both request kinds show up here
// with a `request_type` badge, and clicking a row routes to whichever
// detail screen matches its type. The two review screens themselves stay
// separate components (AdminRequestDetailPage for ORG_CREATION,
// AdminMemberLimitDetailPage for MEMBER_LIMIT_INCREASE) — only this list is
// merged, by design.
//
// Trade-off worth flagging: admin_review_queue (dbschema.sql) is
// deliberately narrow — only the columns both source tables share (id,
// request_type, status, created_at, reviewed_by_admin_id, reviewed_at). That
// means this table can no longer show org_name/reference_code/
// expected_member_count; those live on the detail screen a row's click-through
// lands on, not the list. This is a direct consequence of the
// "read-only union of shared columns only"
// design, chosen specifically so the two source tables didn't have to grow
// always-half-null columns to satisfy this list (see admin_review_queue's
// own comment in dbschema.sql).
const PAGE_SIZE = 25;

// The "Pending setup" tab covers APPROVED_PENDING_SETUP. The queue's default
// "Open" tab deliberately mirrors the backend's open-only default
// (PENDING + NEEDS_INFO) rather than redefining "open" to include it (see
// this file's own comment on that), so it needs its own tab instead of
// folding into "Open"; "All" includes it as well.
//
// APPROVED_PENDING_SETUP is an org_requests-only status (org_member_limit_
// requests' chk_limit_request_status never includes it) — selecting the
// "Pending setup" tab together with the type filter set to "Member limit
// increase" is a legitimate, just-always-empty combination; the backend
// doesn't need to know that's meaningless, it simply returns zero rows.
const STATUS_TABS: Array<{ key: string; label: string; status?: string[] }> = [
  { key: "open", label: "Open" }, // no status param — backend's own open-only default
  {
    key: "pending-setup",
    label: "Pending setup",
    status: ["APPROVED_PENDING_SETUP"],
  },
  { key: "approved", label: "Approved", status: ["APPROVED"] },
  { key: "rejected", label: "Rejected", status: ["REJECTED"] },
  {
    key: "all",
    label: "All",
    status: [
      "PENDING",
      "NEEDS_INFO",
      "APPROVED_PENDING_SETUP",
      "APPROVED",
      "REJECTED",
    ],
  },
];

const TYPE_FILTERS: Array<{
  value: "ALL" | AdminReviewQueueRequestType;
  label: string;
}> = [
  { value: "ALL", label: "All types" },
  { value: "ORG_CREATION", label: "Org creation" },
  { value: "MEMBER_LIMIT_INCREASE", label: "Member limit increase" },
];

const REQUEST_TYPE_BADGE: Record<
  AdminReviewQueueRequestType,
  { label: string; className: string }
> = {
  ORG_CREATION: {
    label: "Org creation",
    className: "bg-violet-50 text-violet-700 border-violet-200",
  },
  MEMBER_LIMIT_INCREASE: {
    label: "Member limit",
    className: "bg-cyan-50 text-cyan-700 border-cyan-200",
  },
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  PENDING: {
    label: "Pending",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  NEEDS_INFO: {
    label: "Needs info",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  APPROVED_PENDING_SETUP: {
    label: "Approved — awaiting setup",
    className: "bg-sky-50 text-sky-700 border-sky-200",
  },
  APPROVED: {
    label: "Approved",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  REJECTED: {
    label: "Rejected",
    className: "bg-rose-50 text-rose-700 border-rose-200",
  },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function AdminRequestQueuePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("open");
  const [typeFilter, setTypeFilter] = useState<
    "ALL" | AdminReviewQueueRequestType
  >("ALL");
  const [page, setPage] = useState(1);
  const [requests, setRequests] = useState<AdminReviewQueueRow[] | null>(
    null,
  );
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeTab = STATUS_TABS.find((t) => t.key === tab) ?? STATUS_TABS[0];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listReviewQueue({
        status: activeTab.status,
        requestType: typeFilter === "ALL" ? undefined : [typeFilter],
        page,
        pageSize: PAGE_SIZE,
      });
      setRequests(res.requests);
      setTotal(res.total);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load requests");
      setRequests([]);
    } finally {
      setLoading(false);
    }
    // activeTab is derived from `tab`, which IS in the dep array — including
    // the derived object itself would just re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, typeFilter, page]);

  useEffect(() => {
    load();
  }, [load]);

  const handleTabChange = (next: string) => {
    setTab(next);
    setPage(1); // switching tabs resets pagination — page 3 of "Open" isn't page 3 of "All"
  };

  const handleTypeChange = (next: "ALL" | AdminReviewQueueRequestType) => {
    setTypeFilter(next);
    setPage(1);
  };

  const handleRowClick = (row: AdminReviewQueueRow) => {
    // request_type is what tells us which detail screen owns this id — the
    // two review screens stay separate components (they are not merged),
    // this is only the routing decision between them.
    if (row.request_type === "MEMBER_LIMIT_INCREASE") {
      navigate(`/member-limit-requests/${row.id}`);
    } else {
      navigate(`/requests/${row.id}`);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-muted/30">
      <AdminHeader />
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Requests</h1>
            <p className="text-sm text-muted-foreground">
              Review and decide on incoming organization and member-limit
              requests.
            </p>
          </div>
          {/* The stuck-request admin view is
              its own page (age-threshold filter, not just a status filter —
              see AdminStuckRequestsPage), so it's a link out rather than a
              sixth tab here. Org-creation only — member-limit requests have
              no "pending setup" state to get stuck in. */}
          <Button variant="outline" size="sm" asChild>
            <Link to="/requests/stuck">
              <Clock className="mr-1.5 size-4" />
              Stuck in setup
            </Link>
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={tab} onValueChange={handleTabChange}>
            <TabsList>
              {STATUS_TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Select value={typeFilter} onValueChange={(v) => handleTypeChange(v as any)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {activeTab.label} requests
              {total > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({total})
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {activeTab.key === "open"
                ? "Awaiting a decision, oldest first within each status."
                : `Requests currently ${activeTab.label.toLowerCase()}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <p className="mb-4 text-sm text-destructive">{error}</p>
            )}

            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Loading...
              </p>
            ) : !requests || requests.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                <Inbox className="size-8" />
                <p className="text-sm">No requests in this view.</p>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Reviewed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((r) => (
                      <TableRow
                        key={`${r.request_type}-${r.id}`}
                        className="cursor-pointer"
                        onClick={() => handleRowClick(r)}
                      >
                        <TableCell className="font-mono text-xs">
                          {r.id}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              REQUEST_TYPE_BADGE[r.request_type].className
                            }
                          >
                            {REQUEST_TYPE_BADGE[r.request_type].label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              STATUS_BADGE[r.status]?.className ??
                              "bg-muted text-muted-foreground"
                            }
                          >
                            {STATUS_BADGE[r.status]?.label ?? r.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(r.created_at)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.reviewed_at ? formatDate(r.reviewed_at) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Page {page} of {totalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="mr-1 size-4" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() =>
                          setPage((p) => Math.min(totalPages, p + 1))
                        }
                      >
                        Next
                        <ChevronRight className="ml-1 size-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
