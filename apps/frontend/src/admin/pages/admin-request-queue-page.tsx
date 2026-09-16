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
import { AdminHeader } from "../components/admin-header";
import {
  adminApi,
  type OrgRequestListItem,
  type OrgRequestStatus,
} from "../lib/admin-api";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";

// EDIT (Phase 3 — admin portal core, subphase 3.5): new. Reads
// GET /admin/org-requests (3.1) — a review queue, not a public list, so it
// defaults to the same open-only view the backend itself defaults to
// (PENDING + NEEDS_INFO) rather than re-deciding that here; the "Open"
// tab passes no `status` param at all for exactly that reason (see
// STATUS_TABS below), so the frontend's idea of "open" can never drift
// from the backend's.
const PAGE_SIZE = 25;

const STATUS_TABS: Array<{
  key: string;
  label: string;
  status?: OrgRequestStatus[];
}> = [
  { key: "open", label: "Open" }, // no status param — backend's own open-only default
  { key: "approved", label: "Approved", status: ["APPROVED"] },
  { key: "rejected", label: "Rejected", status: ["REJECTED"] },
  {
    key: "all",
    label: "All",
    status: ["PENDING", "NEEDS_INFO", "APPROVED", "REJECTED"],
  },
];

const STATUS_BADGE: Record<
  OrgRequestStatus,
  { label: string; className: string }
> = {
  PENDING: {
    label: "Pending",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  NEEDS_INFO: {
    label: "Needs info",
    className: "bg-blue-50 text-blue-700 border-blue-200",
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
  const [page, setPage] = useState(1);
  const [requests, setRequests] = useState<OrgRequestListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeTab = STATUS_TABS.find((t) => t.key === tab) ?? STATUS_TABS[0];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listOrgRequests({
        status: activeTab.status,
        page,
        pageSize: PAGE_SIZE,
      });
      setRequests(res.requests);
      setTotal(res.total);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load org requests");
      setRequests([]);
    } finally {
      setLoading(false);
    }
    // activeTab is derived from `tab`, which IS in the dep array — including
    // the derived object itself would just re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, page]);

  useEffect(() => {
    load();
  }, [load]);

  const handleTabChange = (next: string) => {
    setTab(next);
    setPage(1); // switching tabs resets pagination — page 3 of "Open" isn't page 3 of "All"
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-muted/30">
      <AdminHeader />
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <div>
          <h1 className="text-xl font-semibold">Org requests</h1>
          <p className="text-sm text-muted-foreground">
            Review and decide on incoming organization requests.
          </p>
        </div>

        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList>
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

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
                      <TableHead>Reference</TableHead>
                      <TableHead>Organization</TableHead>
                      <TableHead>Members</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Submitted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((r) => (
                      <TableRow
                        key={r.request_id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/requests/${r.request_id}`)}
                      >
                        <TableCell className="font-mono text-xs">
                          {r.reference_code}
                        </TableCell>
                        <TableCell className="font-medium">
                          {r.org_name}
                        </TableCell>
                        <TableCell>{r.expected_member_count ?? "—"}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={STATUS_BADGE[r.status].className}
                          >
                            {STATUS_BADGE[r.status].label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(r.created_at)}
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
