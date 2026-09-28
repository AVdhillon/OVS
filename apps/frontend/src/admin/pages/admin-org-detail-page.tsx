import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../app/components/ui/card";
import { Badge } from "../../app/components/ui/badge";
import { Button } from "../../app/components/ui/button";
import { Separator } from "../../app/components/ui/separator";
import { Label } from "../../app/components/ui/label";
import { Textarea } from "../../app/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../app/components/ui/dialog";
import { AdminHeader } from "../components/admin-header";
import { adminApi, type OrgDetail, type OrgStatus } from "../lib/admin-api";
import { toast } from "sonner";
import { ArrowLeft, PauseCircle, PlayCircle, Archive } from "lucide-react";

// Reads GET /admin/organizations/:orgid and wires all three lifecycle
// actions to POST /admin/organizations/:orgid/{suspend,reinstate,archive}.
//
// Same shared-dialog-shape idea as admin-request-detail-page.tsx's
// reject/request-info pair, but here all three actions share one dialog
// (suspend/reinstate/archive) rather than two, since OrgLifecycleReasonDto
// is a single `reason` field for all three — see that DTO's own comment on
// why an organization has no requester-facing note column to split across.
// `reason` is required for suspend/archive and optional for reinstate,
// mirroring OrgLifecycleService's own required/optional split (not
// re-decided here) — the dialog enforces that client-side as a convenience,
// but the server is the actual source of truth for which actions require it.

const STATUS_BADGE: Record<OrgStatus, { label: string; className: string }> = {
  ACTIVE: {
    label: "Active",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  SUSPENDED: {
    label: "Suspended",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  ARCHIVED: {
    label: "Archived",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

const ACTION_LABEL: Record<string, string> = {
  ORG_SUSPENDED: "Suspended",
  ORG_REINSTATED: "Reinstated",
  ORG_ARCHIVED: "Archived",
};

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type DialogMode = "suspend" | "reinstate" | "archive" | null;

const DIALOG_COPY: Record<
  Exclude<DialogMode, null>,
  {
    title: string;
    description: string;
    reasonLabel: string;
    reasonRequired: boolean;
    placeholder: string;
    confirmLabel: string;
    submittingLabel: string;
    variant: "default" | "destructive";
  }
> = {
  suspend: {
    title: "Suspend this organization?",
    description:
      "Members will no longer be able to sign in as this organization and its organizers can no longer create new events. This is reversible — you can reinstate it later.",
    reasonLabel: "Reason",
    reasonRequired: true,
    placeholder: "e.g. Reported for suspicious membership activity.",
    confirmLabel: "Suspend",
    submittingLabel: "Suspending...",
    variant: "destructive",
  },
  reinstate: {
    title: "Reinstate this organization?",
    description:
      "Restores normal access — members can sign in again and organizers can create new events.",
    reasonLabel: "Reason (optional)",
    reasonRequired: false,
    placeholder: "e.g. Investigation resolved, no issues found.",
    confirmLabel: "Reinstate",
    submittingLabel: "Reinstating...",
    variant: "default",
  },
  archive: {
    title: "Archive this organization?",
    description:
      "This permanently retires the organization. It cannot be undone, and there is no path back to Active or Suspended.",
    reasonLabel: "Reason",
    reasonRequired: true,
    placeholder: "e.g. Organization requested permanent closure.",
    confirmLabel: "Archive",
    submittingLabel: "Archiving...",
    variant: "destructive",
  },
};

export function AdminOrgDetailPage() {
  const { orgid } = useParams<{ orgid: string }>();

  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgid) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getOrganizationDetail(orgid);
      setDetail(res);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load organization");
    } finally {
      setLoading(false);
    }
  }, [orgid]);

  useEffect(() => {
    load();
  }, [load]);

  const closeDialog = () => {
    if (submitting) return;
    setDialogMode(null);
    setReason("");
    setFormError(null);
  };

  const handleConfirm = async () => {
    if (!orgid || !dialogMode) return;
    const copy = DIALOG_COPY[dialogMode];
    const trimmed = reason.trim();
    if (copy.reasonRequired && trimmed.length < 3) {
      setFormError("Enter a reason (at least 3 characters).");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const body = trimmed ? { reason: trimmed } : {};
      const res =
        dialogMode === "suspend"
          ? await adminApi.suspendOrganization(orgid, body)
          : dialogMode === "reinstate"
            ? await adminApi.reinstateOrganization(orgid, body)
            : await adminApi.archiveOrganization(orgid, body);
      toast.success(res.message);
      closeDialog();
      await load();
    } catch (e: any) {
      setFormError(e?.message ?? `Failed to ${dialogMode} organization`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <AdminHeader />
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Link
          to="/organizations"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to organizations
        </Link>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading...
          </p>
        ) : error || !detail ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-destructive">
              {error ?? "Organization not found"}
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold">
                    {detail.org_name}
                  </h1>
                  <Badge
                    variant="outline"
                    className={STATUS_BADGE[detail.status].className}
                  >
                    {STATUS_BADGE[detail.status].label}
                  </Badge>
                </div>
                <p className="font-mono text-sm text-muted-foreground">
                  {detail.orgid}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {detail.status === "ACTIVE" && (
                  <Button
                    variant="outline"
                    className="border-amber-300 text-amber-700 hover:bg-amber-50"
                    onClick={() => setDialogMode("suspend")}
                  >
                    <PauseCircle className="mr-1.5 size-4" />
                    Suspend
                  </Button>
                )}
                {detail.status === "SUSPENDED" && (
                  <Button onClick={() => setDialogMode("reinstate")}>
                    <PlayCircle className="mr-1.5 size-4" />
                    Reinstate
                  </Button>
                )}
                {detail.status !== "ARCHIVED" && (
                  <Button
                    variant="outline"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => setDialogMode("archive")}
                  >
                    <Archive className="mr-1.5 size-4" />
                    Archive
                  </Button>
                )}
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Overview</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-muted-foreground">Email</p>
                  <p>{detail.org_email ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Members</p>
                  <p>{detail.member_count}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Scopes</p>
                  <p>{detail.scope_count}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Registered</p>
                  <p>{formatDateTime(detail.created_at)}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Event activity</CardTitle>
                <CardDescription>
                  {detail.events.total} event
                  {detail.events.total === 1 ? "" : "s"} total.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Active</p>
                  <p>{detail.events.active}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Completed</p>
                  <p>{detail.events.completed}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Cancelled</p>
                  <p>{detail.events.cancelled}</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Admin history</CardTitle>
                <CardDescription>
                  Every suspend/reinstate/archive action on this
                  organization, most recent first.{" "}
                  {/* Deep link into the audit-log viewer, pre-scoped to this
                      org. This card shows admin *intent* only; the viewer
                      pairs it with the underlying row changes, including
                      ones no admin caused. Without this link the viewer is
                      unreachable from the place an admin would look for it. */}
                  <Link
                    to={`/audit?target_type=ORGANIZATION&target_id=${encodeURIComponent(
                      detail.orgid,
                    )}`}
                    className="underline underline-offset-2"
                  >
                    View full change history
                  </Link>
                </CardDescription>
              </CardHeader>
              <CardContent>
                {detail.audit_trail.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No admin actions have been recorded yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {detail.audit_trail.map((entry, i) => (
                      <div key={entry.admin_log_id}>
                        {i > 0 && <Separator className="mb-3" />}
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">
                            {ACTION_LABEL[entry.action] ?? entry.action}
                          </span>
                          <span className="text-muted-foreground">
                            {formatDateTime(entry.created_at)}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          by {entry.admin_id}
                        </p>
                        {entry.reason && (
                          <p className="mt-1 text-sm">{entry.reason}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* ── Suspend / Reinstate / Archive (shared shape) ────────────────── */}
      <Dialog
        open={dialogMode !== null}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent>
          {dialogMode && (
            <>
              <DialogHeader>
                <DialogTitle>{DIALOG_COPY[dialogMode].title}</DialogTitle>
                <DialogDescription>
                  {DIALOG_COPY[dialogMode].description}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reason">
                    {DIALOG_COPY[dialogMode].reasonLabel}
                  </Label>
                  <Textarea
                    id="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={DIALOG_COPY[dialogMode].placeholder}
                    rows={3}
                  />
                </div>
                {formError && (
                  <p className="text-sm text-destructive">{formError}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={closeDialog}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  variant={DIALOG_COPY[dialogMode].variant}
                  onClick={handleConfirm}
                  disabled={submitting}
                >
                  {submitting
                    ? DIALOG_COPY[dialogMode].submittingLabel
                    : DIALOG_COPY[dialogMode].confirmLabel}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
