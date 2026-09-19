import { useEffect, useState, useCallback } from "react";
import { useSearchParams, Link } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../app/components/ui/card";
import { Badge } from "../../app/components/ui/badge";
import { Button } from "../../app/components/ui/button";
import { Input } from "../../app/components/ui/input";
import { Label } from "../../app/components/ui/label";
import { Separator } from "../../app/components/ui/separator";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../../app/components/ui/table";
import { AdminHeader } from "../components/admin-header";
import {
  adminApi,
  type AdminAction,
  type AdminAuditLogEntry,
  type AdminTargetType,
  type AuditEntryDetail,
  type AuditRowDiff,
  type OrgChangesResponse,
} from "../lib/admin-api";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ScrollText,
  X,
} from "lucide-react";

// EDIT (Phase 5 — platform maturity, subphase 5.1): new. The plan's own
// description is "surface admin_audit_log (intent) with drill-down into
// audit_logs (row diffs) for a given org", and this is the one admin page
// that subphase calls for. It reads all three of AuditAdminController's
// routes:
//
//   * GET /admin/audit                          -> the feed (the table)
//   * GET /admin/audit/:adminLogId              -> expanding a feed row
//   * GET /admin/audit/organizations/:orgid     -> the org panel
//
// **URL-driven rather than tab-driven**, unlike 3.5's request queue and
// 3.6's org directory (both of which keep their filter in local state). Two
// reasons: an auditor's whole workflow is "here is the thing I was looking
// at" — a filtered audit view needs to be a link someone can paste into a
// ticket — and it lets 3.6's org-detail page deep-link straight here
// (?target_type=ORGANIZATION&target_id=ABC1234) instead of this subphase
// having to add a second page for the per-org view.
//
// When the filter is scoped to one organization, the page additionally
// renders that org's full row-diff history from the third route. That is
// deliberately *not* the same data as expanding a feed row: a feed row's
// drill-down shows the rows moved by one admin action, while the org panel
// shows every audited change to the org including ones no admin caused
// (a member joining, an event being created). Both halves matter — the
// plan's pairing is intent *with* drill-down, not intent *instead of* it.

const PAGE_SIZE = 25;
const ORG_CHANGES_PAGE_SIZE = 25;

const ACTION_LABEL: Record<AdminAction, string> = {
  ORG_REQUEST_APPROVED: "Request approved",
  ORG_REQUEST_REJECTED: "Request rejected",
  ORG_REQUEST_INFO_REQUESTED: "More info requested",
  ORG_SUSPENDED: "Org suspended",
  ORG_REINSTATED: "Org reinstated",
  ORG_ARCHIVED: "Org archived",
  ADMIN_INVITED: "Admin invited",
  ADMIN_DEACTIVATED: "Admin deactivated",
};

// Adverse/irreversible actions read amber-to-red; the two restorative ones
// read green. Mirrors which actions chk_admin_audit_reason_required insists
// on a justification for — the same split, surfaced visually.
const ACTION_CLASS: Record<AdminAction, string> = {
  ORG_REQUEST_APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ORG_REQUEST_REJECTED: "bg-red-50 text-red-700 border-red-200",
  ORG_REQUEST_INFO_REQUESTED: "bg-amber-50 text-amber-700 border-amber-200",
  ORG_SUSPENDED: "bg-amber-50 text-amber-700 border-amber-200",
  ORG_REINSTATED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ORG_ARCHIVED: "bg-red-50 text-red-700 border-red-200",
  ADMIN_INVITED: "bg-sky-50 text-sky-700 border-sky-200",
  ADMIN_DEACTIVATED: "bg-red-50 text-red-700 border-red-200",
};

const OPERATION_CLASS: Record<string, string> = {
  INSERT: "bg-emerald-50 text-emerald-700 border-emerald-200",
  UPDATE: "bg-sky-50 text-sky-700 border-sky-200",
  DELETE: "bg-red-50 text-red-700 border-red-200",
};

function actionLabel(action: string) {
  return ACTION_LABEL[action as AdminAction] ?? action;
}

function actionClass(action: string) {
  return (
    ACTION_CLASS[action as AdminAction] ??
    "bg-slate-100 text-slate-600 border-slate-200"
  );
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Renders one audit_logs row's changed_data as a key/value grid. The
 * payload is to_jsonb(NEW) — the whole row after the change, not a
 * before/after delta — so this is presented as a snapshot rather than
 * labelled a "diff" in the UI, which would promise more than the trigger
 * actually records. Nested values are JSON-stringified rather than
 * recursed into; none of the audited tables has a nested JSONB column
 * today, so a one-level grid is honest and a tree view would be scaffolding
 * for a case that doesn't exist yet.
 */
function ChangedDataGrid({ data }: { data: Record<string, unknown> | null }) {
  if (!data || Object.keys(data).length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No column data recorded.</p>
    );
  }
  return (
    <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="flex gap-2 text-xs">
          <span className="shrink-0 font-mono text-muted-foreground">
            {key}
          </span>
          <span className="break-all font-mono">
            {value === null
              ? "null"
              : typeof value === "object"
                ? JSON.stringify(value)
                : String(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function RowDiffList({ changes }: { changes: AuditRowDiff[] }) {
  if (changes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No row changes were recorded alongside this action.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {changes.map((change, i) => (
        <div key={change.log_id}>
          {i > 0 && <Separator className="mb-3" />}
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium">
              {change.table_name}
            </span>
            <Badge
              variant="outline"
              className={
                OPERATION_CLASS[change.operation] ??
                "bg-slate-100 text-slate-600 border-slate-200"
              }
            >
              {change.operation}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(change.changed_at)}
            </span>
            {change.changed_by && (
              <span className="text-xs text-muted-foreground">
                db role: {change.changed_by}
              </span>
            )}
          </div>
          <ChangedDataGrid data={change.changed_data} />
        </div>
      ))}
    </div>
  );
}

/** One feed row, expandable into the rows its transaction moved. */
function AuditFeedRow({ entry }: { entry: AdminAuditLogEntry }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<AuditEntryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetched on first expand rather than eagerly with the feed: the feed is
  // 25 rows and each drill-down is its own query, so loading all of them up
  // front would be 26 round trips to render a page an auditor will usually
  // expand one row of.
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || detail || loading) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(await adminApi.getAuditEntryDetail(entry.admin_log_id));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load row changes");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <TableRow className="cursor-pointer" onClick={toggle}>
        <TableCell className="text-muted-foreground">
          {open ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </TableCell>
        <TableCell>
          <Badge variant="outline" className={actionClass(entry.action)}>
            {actionLabel(entry.action)}
          </Badge>
        </TableCell>
        <TableCell className="font-mono text-xs">{entry.admin_id}</TableCell>
        <TableCell className="text-xs">
          <span className="text-muted-foreground">{entry.target_type}</span>{" "}
          <span className="font-mono">{entry.target_id}</span>
        </TableCell>
        <TableCell className="max-w-xs truncate text-sm">
          {entry.reason ?? "—"}
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(entry.created_at)}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/40">
            {loading ? (
              <p className="py-2 text-sm text-muted-foreground">Loading...</p>
            ) : error ? (
              <p className="py-2 text-sm text-destructive">{error}</p>
            ) : detail ? (
              <div className="space-y-3 py-1">
                <div className="text-sm">
                  <span className="text-muted-foreground">Performed by </span>
                  {detail.admin ? (
                    <>
                      {detail.admin.name} ({detail.admin.admin_id})
                      {!detail.admin.is_active && (
                        <span className="ml-1 text-muted-foreground">
                          — since deactivated
                        </span>
                      )}
                    </>
                  ) : (
                    entry.admin_id
                  )}
                </div>
                {detail.metadata && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Action metadata
                    </p>
                    <ChangedDataGrid data={detail.metadata} />
                  </div>
                )}
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Rows written in the same transaction
                  </p>
                  <RowDiffList changes={detail.changes} />
                </div>
              </div>
            ) : null}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function AdminAuditLogPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const adminId = searchParams.get("admin_id") ?? "";
  const targetType = (searchParams.get("target_type") ??
    "") as AdminTargetType | "";
  const targetId = searchParams.get("target_id") ?? "";
  const page = Number(searchParams.get("page") ?? "1") || 1;

  const [adminIdInput, setAdminIdInput] = useState(adminId);
  const [targetIdInput, setTargetIdInput] = useState(targetId);

  const [entries, setEntries] = useState<AdminAuditLogEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Only meaningful when the filter names one organization — see the header
  // comment on why this panel is a different question from a feed row's own
  // drill-down.
  const scopedOrgid = targetType === "ORGANIZATION" ? targetId : "";
  const [orgChanges, setOrgChanges] = useState<OrgChangesResponse | null>(null);
  const [orgTable, setOrgTable] = useState<string>("");
  const [orgPage, setOrgPage] = useState(1);
  const [orgError, setOrgError] = useState<string | null>(null);

  useEffect(() => {
    setAdminIdInput(adminId);
    setTargetIdInput(targetId);
  }, [adminId, targetId]);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listAuditEntries({
        adminId: adminId || undefined,
        targetType: targetType || undefined,
        targetId: targetId || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setEntries(res.entries);
      setTotal(res.total);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load the audit log");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [adminId, targetType, targetId, page]);

  useEffect(() => {
    loadFeed();
  }, [loadFeed]);

  const loadOrgChanges = useCallback(async () => {
    if (!scopedOrgid) {
      setOrgChanges(null);
      return;
    }
    setOrgError(null);
    try {
      setOrgChanges(
        await adminApi.listOrgAuditChanges(scopedOrgid, {
          table: orgTable || undefined,
          page: orgPage,
          pageSize: ORG_CHANGES_PAGE_SIZE,
        }),
      );
    } catch (e: any) {
      setOrgError(e?.message ?? "Failed to load the change history");
      setOrgChanges(null);
    }
  }, [scopedOrgid, orgTable, orgPage]);

  useEffect(() => {
    loadOrgChanges();
  }, [loadOrgChanges]);

  // Every filter change resets to page 1 — page 3 of one filter isn't page 3
  // of another. Same reasoning 3.5/3.6 apply on tab and search changes.
  const applyFilters = (next: {
    admin_id?: string;
    target_type?: string;
    target_id?: string;
  }) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    setSearchParams(params);
    setOrgPage(1);
    setOrgTable("");
  };

  const setPage = (next: number) => {
    const params = new URLSearchParams(searchParams);
    if (next > 1) params.set("page", String(next));
    else params.delete("page");
    setSearchParams(params);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    applyFilters({
      admin_id: adminIdInput.trim(),
      target_id: targetIdInput.trim(),
      target_type: targetType || undefined,
    });
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(adminId || targetType || targetId);
  const orgTotalPages = orgChanges
    ? Math.max(1, Math.ceil(orgChanges.total / ORG_CHANGES_PAGE_SIZE))
    : 1;

  return (
    <div className="min-h-screen bg-muted/30">
      <AdminHeader />
      <div className="mx-auto max-w-6xl space-y-4 p-6">
        <div>
          <h1 className="text-xl font-semibold">Audit log</h1>
          <p className="text-sm text-muted-foreground">
            Every administrative action on the platform, newest first. Expand
            a row to see the database rows its transaction wrote.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <form
              onSubmit={handleSearchSubmit}
              className="flex flex-wrap items-end gap-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor="admin_id" className="text-xs">
                  Admin
                </Label>
                <Input
                  id="admin_id"
                  value={adminIdInput}
                  onChange={(e) => setAdminIdInput(e.target.value)}
                  placeholder="SA0001"
                  className="w-40"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="target_id" className="text-xs">
                  Target ID
                </Label>
                <Input
                  id="target_id"
                  value={targetIdInput}
                  onChange={(e) => setTargetIdInput(e.target.value)}
                  placeholder="ABC1234 or a request id"
                  className="w-56"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Target type</Label>
                <div className="flex gap-1">
                  {(
                    [
                      "ORG_REQUEST",
                      "ORGANIZATION",
                      "SITE_ADMIN",
                    ] as AdminTargetType[]
                  ).map((t) => (
                    <Button
                      key={t}
                      type="button"
                      size="sm"
                      variant={targetType === t ? "default" : "outline"}
                      onClick={() =>
                        applyFilters({
                          admin_id: adminIdInput.trim(),
                          target_id: targetIdInput.trim(),
                          target_type: targetType === t ? "" : t,
                        })
                      }
                    >
                      {t === "ORG_REQUEST"
                        ? "Requests"
                        : t === "ORGANIZATION"
                          ? "Organizations"
                          : "Admins"}
                    </Button>
                  ))}
                </div>
              </div>
              <Button type="submit" variant="outline" size="sm">
                Apply
              </Button>
              {hasFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    applyFilters({
                      admin_id: "",
                      target_id: "",
                      target_type: "",
                    })
                  }
                >
                  <X className="mr-1 size-4" />
                  Clear
                </Button>
              )}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              Admin actions
              {total > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({total})
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {hasFilters
                ? "Matching the filters above."
                : "The complete record — nothing is hidden by default."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Loading...
              </p>
            ) : !entries || entries.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                <ScrollText className="size-8" />
                <p className="text-sm">No admin actions in this view.</p>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>Action</TableHead>
                      <TableHead>Admin</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => (
                      <AuditFeedRow key={entry.admin_log_id} entry={entry} />
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
                        onClick={() => setPage(Math.max(1, page - 1))}
                      >
                        <ChevronLeft className="mr-1 size-4" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() => setPage(Math.min(totalPages, page + 1))}
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

        {scopedOrgid && (
          <Card>
            <CardHeader>
              <CardTitle>
                Change history
                {orgChanges && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({orgChanges.total})
                  </span>
                )}
              </CardTitle>
              <CardDescription>
                {orgChanges ? (
                  <>
                    Every audited row change touching{" "}
                    <span className="font-medium">
                      {orgChanges.organization.org_name}
                    </span>{" "}
                    ({scopedOrgid}) — including changes no admin caused, such
                    as members joining or events being created.{" "}
                    <Link
                      to={`/organizations/${scopedOrgid}`}
                      className="underline underline-offset-2"
                    >
                      Open the organization
                    </Link>
                  </>
                ) : (
                  `Row-level history for ${scopedOrgid}.`
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {orgError && (
                <p className="text-sm text-destructive">{orgError}</p>
              )}

              {orgChanges && (
                <>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant={orgTable === "" ? "default" : "outline"}
                      onClick={() => {
                        setOrgTable("");
                        setOrgPage(1);
                      }}
                    >
                      All tables
                    </Button>
                    {/* Built from the server's own available_tables rather
                        than a second copy of the list here. */}
                    {orgChanges.available_tables.map((t) => (
                      <Button
                        key={t}
                        size="sm"
                        variant={orgTable === t ? "default" : "outline"}
                        onClick={() => {
                          setOrgTable(t);
                          setOrgPage(1);
                        }}
                      >
                        {t}
                      </Button>
                    ))}
                  </div>

                  {orgChanges.changes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No row changes recorded in this view.
                    </p>
                  ) : (
                    <RowDiffList changes={orgChanges.changes} />
                  )}

                  {orgTotalPages > 1 && (
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        Page {orgPage} of {orgTotalPages}
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={orgPage <= 1}
                          onClick={() => setOrgPage((p) => Math.max(1, p - 1))}
                        >
                          <ChevronLeft className="mr-1 size-4" />
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={orgPage >= orgTotalPages}
                          onClick={() =>
                            setOrgPage((p) => Math.min(orgTotalPages, p + 1))
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
        )}
      </div>
    </div>
  );
}
