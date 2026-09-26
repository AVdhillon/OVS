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
import {
  adminApi,
  type MemberLimitRequestDetail,
  type MemberLimitRequestStatus,
} from "../lib/admin-api";
import { toast } from "sonner";
import { ArrowLeft, Check, X, HelpCircle } from "lucide-react";

// ─── Member limit request detail/review page (Phase 7 — Member Limit
// Increase Requests, subphase 7.4) ──────────────────────────────────────────
// EDIT (subphase 7.4): new. The admin-facing counterpart to
// AdminRequestDetailPage, for org_member_limit_requests specifically —
// deliberately its own component rather than a mode flag on that one, per
// the plan's own 7.4 text ("the two review screens themselves stay as
// separate components (their approve actions take different inputs: a
// member limit number vs. nothing)"). Reads
// GET /admin/member-limit-requests/:requestId (7.3) and wires approve/
// reject/needs-info to MemberLimitRequestsAdminController's three POST
// routes (also 7.3).
//
// Simpler than AdminRequestDetailPage in one specific way: approve() here
// takes NO body — org_member_limit_requests already carries requested_limit
// on the row itself, so there's no member-limit field for the admin to
// fill in (unlike org_requests, which has no requested number of its own).
// Approve is a plain confirm dialog, not a form.

const STATUS_BADGE: Record<
  MemberLimitRequestStatus,
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

// Mirrors admin-request-detail-page.tsx's ACTION_LABEL, for this table's own
// admin_audit_log.action values (7.2's dbschema.sql addition covers the
// third one here — see that subphase's own comment on why it had to be
// added).
const ACTION_LABEL: Record<string, string> = {
  MEMBER_LIMIT_INCREASE_APPROVED: "Approved",
  MEMBER_LIMIT_INCREASE_REJECTED: "Rejected",
  MEMBER_LIMIT_INCREASE_INFO_REQUESTED: "Requested more information",
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

type DialogMode = "approve" | "reject" | "needs-info" | null;

export function AdminMemberLimitDetailPage() {
  const { requestId } = useParams<{ requestId: string }>();

  const [detail, setDetail] = useState<MemberLimitRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!requestId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getMemberLimitRequestDetail(requestId);
      setDetail(res);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load request");
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    load();
  }, [load]);

  const isOpen = detail?.status === "PENDING" || detail?.status === "NEEDS_INFO";

  const closeDialog = () => {
    if (submitting) return;
    setDialogMode(null);
    setReason("");
    setFormError(null);
  };

  const handleApprove = async () => {
    if (!requestId) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await adminApi.approveMemberLimitRequest(requestId);
      toast.success(res.message);
      closeDialog();
      await load();
    } catch (e: any) {
      setFormError(e?.message ?? "Failed to approve request");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!requestId) return;
    if (reason.trim().length < 3) {
      setFormError("Enter a reason (at least 3 characters).");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await adminApi.rejectMemberLimitRequest(requestId, {
        reason: reason.trim(),
      });
      toast.success(res.message);
      closeDialog();
      await load();
    } catch (e: any) {
      setFormError(e?.message ?? "Failed to reject request");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestInfo = async () => {
    if (!requestId) return;
    if (reason.trim().length < 3) {
      setFormError("Enter what's missing (at least 3 characters).");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await adminApi.requestInfoOnMemberLimitRequest(requestId, {
        reason: reason.trim(),
      });
      toast.success(res.message);
      closeDialog();
      await load();
    } catch (e: any) {
      setFormError(e?.message ?? "Failed to request more information");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <AdminHeader />
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Link
          to="/requests"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to requests
        </Link>

        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading...
          </p>
        ) : error || !detail ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-destructive">
              {error ?? "Request not found"}
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold">
                    {detail.organization?.org_name ?? detail.orgid}
                  </h1>
                  <Badge
                    variant="outline"
                    className={STATUS_BADGE[detail.status].className}
                  >
                    {STATUS_BADGE[detail.status].label}
                  </Badge>
                </div>
                <p className="font-mono text-sm text-muted-foreground">
                  {detail.orgid} · request #{detail.request_id}
                </p>
              </div>
              {isOpen && (
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setDialogMode("needs-info")}
                  >
                    <HelpCircle className="mr-1.5 size-4" />
                    Needs info
                  </Button>
                  <Button
                    variant="outline"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => setDialogMode("reject")}
                  >
                    <X className="mr-1.5 size-4" />
                    Reject
                  </Button>
                  <Button onClick={() => setDialogMode("approve")}>
                    <Check className="mr-1.5 size-4" />
                    Approve
                  </Button>
                </div>
              )}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Requested change</CardTitle>
                <CardDescription>
                  Submitted by {detail.requester?.uid ?? detail.requested_by_uid}
                  {detail.requester?.email ? ` · ${detail.requester.email}` : ""}
                  {detail.requester?.mobile ? ` · ${detail.requester.mobile}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Current limit</p>
                  <p className="text-lg font-semibold">{detail.current_limit}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Requested limit</p>
                  <p className="text-lg font-semibold">{detail.requested_limit}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-sm text-muted-foreground">Justification</p>
                  <p className="text-sm">{detail.justification ?? "—"}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Submitted</p>
                  <p className="text-sm">{formatDateTime(detail.created_at)}</p>
                </div>
              </CardContent>
            </Card>

            {(detail.status === "REJECTED" || detail.status === "NEEDS_INFO") && (
              <Card>
                <CardHeader>
                  <CardTitle>Review outcome</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    By {detail.reviewed_by_admin_id ?? "—"} on{" "}
                    {formatDateTime(detail.reviewed_at)}
                  </p>
                  {detail.review_note && (
                    <p className="text-sm">{detail.review_note}</p>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Activity</CardTitle>
              </CardHeader>
              <CardContent>
                {detail.audit_trail.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No decisions have been recorded yet.
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

      {/* ── Approve — plain confirm, no fields ──────────────────────────── */}
      <Dialog
        open={dialogMode === "approve"}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve this request?</DialogTitle>
            <DialogDescription>
              {detail
                ? `Raises ${detail.organization?.org_name ?? detail.orgid}'s member limit from ${detail.current_limit} to ${detail.requested_limit} immediately.`
                : "Raises the organization's member limit immediately."}
            </DialogDescription>
          </DialogHeader>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleApprove} disabled={submitting}>
              {submitting ? "Approving..." : "Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reject / Needs-info (shared shape) ──────────────────────────── */}
      {/* No internal_note field here, unlike AdminRequestDetailPage's
          equivalent dialog — ReviewLimitRequestDto (7.3) has only `reason`,
          see that DTO's own comment for why. */}
      <Dialog
        open={dialogMode === "reject" || dialogMode === "needs-info"}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "reject"
                ? "Reject this request"
                : "Ask for more information"}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === "reject"
                ? "Shown to the organizer as the reason their request was rejected."
                : "Shown to the organizer as what they need to provide."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reason">
                {dialogMode === "reject" ? "Reason" : "What's missing"}
              </Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  dialogMode === "reject"
                    ? "e.g. Requested increase is disproportionate to current usage."
                    : "e.g. Please describe why you need this many additional seats."
                }
                rows={3}
              />
            </div>
            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant={dialogMode === "reject" ? "destructive" : "default"}
              onClick={
                dialogMode === "reject" ? handleReject : handleRequestInfo
              }
              disabled={submitting}
            >
              {submitting
                ? "Submitting..."
                : dialogMode === "reject"
                  ? "Reject request"
                  : "Send back for info"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
