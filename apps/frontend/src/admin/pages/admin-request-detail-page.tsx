import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router";
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
import { Input } from "../../app/components/ui/input";
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "../../app/components/ui/alert";
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
  type OrgRequestDetail,
  type OrgRequestStatus,
} from "../lib/admin-api";
import { toast } from "sonner";
import { ArrowLeft, Check, X, HelpCircle, Undo2 } from "lucide-react";

// Reads GET /admin/org-requests/:requestId and wires the review outcomes
// to POST /admin/org-requests/:requestId/{approve,reject,request-info}.
//
// approve() takes a required `member_limit` and only moves the request to
// APPROVED_PENDING_SETUP rather than creating the organization; the
// requester finishes setup themselves. Its dialog therefore carries a
// member-limit field, pre-filled from expected_member_count. A fourth
// dialog, revoke-approval, is the terminal action for an
// APPROVED_PENDING_SETUP request that never got finalized. reject() and
// requestInfo() share one dialog shape
// collecting `reason` (requester-facing) and an optional `internal_note`
// (audit-log-only, falls back to `reason` server-side) — mirrors
// ReviewOrgRequestDto's own comment on why those two fields are separate.
// revoke-approval reuses that exact same dialog shape (same DTO
// server-side), since revoking an approval is just as adverse an action as
// a reject.

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

const ACTION_LABEL: Record<string, string> = {
  ORG_REQUEST_APPROVED: "Approved",
  ORG_REQUEST_REJECTED: "Rejected",
  ORG_REQUEST_INFO_REQUESTED: "Requested more information",
  ORG_REQUEST_APPROVAL_REVOKED: "Approval revoked",
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

function getRequesterName(requester: OrgRequestDetail["requester"]) {
  if (!requester) return "Unknown requester";
  return [requester.first_name, requester.middle_name, requester.last_name]
    .filter(Boolean)
    .join(" ");
}

type DialogMode = "approve" | "reject" | "request-info" | "revoke" | null;

export function AdminRequestDetailPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<OrgRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [reason, setReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  // Required by approve(). Seeded from expected_member_count when the
  // approve dialog opens (see openApproveDialog() below) as a starting
  // suggestion; the admin can edit it before confirming.
  const [memberLimit, setMemberLimit] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!requestId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getOrgRequestDetail(requestId);
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
  const isPendingSetup = detail?.status === "APPROVED_PENDING_SETUP";
  // The "Review outcome" card below covers terminal review_note/reviewer
  // context — APPROVED_PENDING_SETUP gets its own Alert instead (above),
  // so it's excluded here rather than showing two overlapping summaries.
  const isTerminal = detail?.status === "APPROVED" || detail?.status === "REJECTED";

  const closeDialog = () => {
    if (submitting) return;
    setDialogMode(null);
    setReason("");
    setInternalNote("");
    setMemberLimit("");
    setFormError(null);
  };

  const openApproveDialog = () => {
    // Starting suggestion only; the admin can change it before confirming.
    setMemberLimit(
      detail?.expected_member_count ? String(detail.expected_member_count) : "",
    );
    setDialogMode("approve");
  };

  const handleApprove = async () => {
    if (!requestId) return;
    const limit = Number(memberLimit);
    if (!Number.isInteger(limit) || limit < 1) {
      setFormError("Enter a member limit of at least 1.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await adminApi.approveOrgRequest(requestId, {
        member_limit: limit,
      });
      toast.success(res.message);
      closeDialog();
      await load();
    } catch (e: any) {
      setFormError(e?.message ?? "Failed to approve request");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeApproval = async () => {
    if (!requestId) return;
    if (reason.trim().length < 3) {
      setFormError("Enter a reason (at least 3 characters).");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await adminApi.revokeOrgRequestApproval(requestId, {
        reason: reason.trim(),
        internal_note: internalNote.trim() || undefined,
      });
      toast.success(res.message);
      closeDialog();
      await load();
    } catch (e: any) {
      setFormError(e?.message ?? "Failed to revoke approval");
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
      const res = await adminApi.rejectOrgRequest(requestId, {
        reason: reason.trim(),
        internal_note: internalNote.trim() || undefined,
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
      const res = await adminApi.requestInfoOnOrgRequest(requestId, {
        reason: reason.trim(),
        internal_note: internalNote.trim() || undefined,
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
                  {detail.reference_code}
                </p>
              </div>
              {isOpen && (
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setDialogMode("request-info")}
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
                  <Button onClick={openApproveDialog}>
                    <Check className="mr-1.5 size-4" />
                    Approve
                  </Button>
                </div>
              )}
              {isPendingSetup && (
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => setDialogMode("revoke")}
                  >
                    <Undo2 className="mr-1.5 size-4" />
                    Revoke approval
                  </Button>
                </div>
              )}
            </div>

            {isPendingSetup && (
              <Alert>
                <AlertTitle>Awaiting requester setup</AlertTitle>
                <AlertDescription>
                  Approved with a member limit of{" "}
                  <strong>{detail.admin_set_member_limit ?? "—"}</strong> on{" "}
                  {formatDateTime(detail.reviewed_at)}. The requester still
                  needs to complete setup before the organization is
                  created — nothing has been created yet.
                </AlertDescription>
              </Alert>
            )}
            <Card>
              <CardHeader>
                <CardTitle>Request details</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Requested email</p>
                  <p>{detail.org_email ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Expected members</p>
                  <p>{detail.expected_member_count ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Submitted</p>
                  <p>{formatDateTime(detail.created_at)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Last updated</p>
                  <p>{formatDateTime(detail.updated_at)}</p>
                </div>
                {detail.justification && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground">Justification</p>
                    <p className="whitespace-pre-wrap">
                      {detail.justification}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Requester</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Name</p>
                  <p>{getRequesterName(detail.requester)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Contact</p>
                  <p>
                    {detail.requester?.email ??
                      detail.requester?.mobile ??
                      "—"}
                  </p>
                </div>
              </CardContent>
            </Card>

            {isTerminal && (
              <Card>
                <CardHeader>
                  <CardTitle>Review outcome</CardTitle>
                  <CardDescription>
                    Reviewed by {detail.reviewer?.name ?? "an admin"} on{" "}
                    {formatDateTime(detail.reviewed_at)}
                  </CardDescription>
                </CardHeader>
                {detail.review_note && (
                  <CardContent className="text-sm">
                    <p className="text-muted-foreground">
                      Note shown to requester
                    </p>
                    <p className="whitespace-pre-wrap">
                      {detail.review_note}
                    </p>
                  </CardContent>
                )}
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Review history</CardTitle>
                <CardDescription>
                  Every decision made on this request, most recent first.
                </CardDescription>
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

      {/* ── Approve (member limit) ──────────────────────────────────────── */}
      {/* Not a plain confirm: approve() only moves the request to
          APPROVED_PENDING_SETUP and needs a member limit to do it; the
          requester still has to complete setup before the organization
          actually exists. */}
      <Dialog
        open={dialogMode === "approve"}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve this request</DialogTitle>
            <DialogDescription>
              Sets the organization's member limit and lets the requester
              finish setup. The organization is not created yet — that
              happens once the requester completes setup on their end.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="member-limit">Member limit</Label>
              <Input
                id="member-limit"
                type="number"
                min={1}
                step={1}
                value={memberLimit}
                onChange={(e) => setMemberLimit(e.target.value)}
                placeholder="e.g. 50"
              />
              <p className="text-xs text-muted-foreground">
                {detail?.expected_member_count
                  ? `Requester estimated ${detail.expected_member_count}. You can set a different limit.`
                  : "No estimate was given — set a limit for this organization."}
              </p>
            </div>
            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
          </div>
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

      {/* ── Revoke approval ───────────────────────────────────────── */}
      {/* Only reachable from APPROVED_PENDING_SETUP (isPendingSetup gates the
          button that opens this) — mirrors revokeApproval()'s own
          server-side status check. Shares the reject/needs-info dialog's
          reason + internal-note shape since it's an equally adverse,
          equally justification-worthy action. */}
      <Dialog
        open={dialogMode === "revoke"}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this approval?</DialogTitle>
            <DialogDescription>
              The request moves to Rejected and the organization name frees
              up again. Use this when a requester never finishes setup
              after being approved. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="revoke-reason">Reason</Label>
              <Textarea
                id="revoke-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Approved 30+ days ago; setup was never completed."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="revoke-internal-note">
                Internal note{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="revoke-internal-note"
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                placeholder="Not shown to the requester. Defaults to the reason above if left blank."
                rows={2}
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
              variant="destructive"
              onClick={handleRevokeApproval}
              disabled={submitting}
            >
              {submitting ? "Revoking..." : "Revoke approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reject / Needs-info (shared shape) ──────────────────────────── */}
      <Dialog
        open={dialogMode === "reject" || dialogMode === "request-info"}
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
                ? "Shown to the requester as the reason their request was rejected."
                : "Shown to the requester as what they need to provide before resubmitting."}
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
                    ? "e.g. This looks like a duplicate of an existing organization."
                    : "e.g. Please confirm your organization's official email domain."
                }
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="internal-note">
                Internal note{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="internal-note"
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                placeholder="Not shown to the requester. Defaults to the reason above if left blank."
                rows={2}
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
