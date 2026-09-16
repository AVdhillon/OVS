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
import { ArrowLeft, Check, X, HelpCircle } from "lucide-react";

// EDIT (Phase 3 — admin portal core, subphase 3.5): new. Reads
// GET /admin/org-requests/:requestId (3.1) and wires all three review
// outcomes to POST /admin/org-requests/:requestId/{approve,reject,
// request-info} (also 3.1, calling 2.4/2.5's service methods).
//
// approve() takes no body (see the controller/ReviewOrgRequestDto notes —
// the request row itself is the justification for an approval), so its
// dialog is a plain confirm; reject()/requestInfo() share one dialog shape
// collecting `reason` (requester-facing) and an optional `internal_note`
// (audit-log-only, falls back to `reason` server-side) — mirrors
// ReviewOrgRequestDto's own comment on why those two fields are separate.

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

const ACTION_LABEL: Record<string, string> = {
  ORG_REQUEST_APPROVED: "Approved",
  ORG_REQUEST_REJECTED: "Rejected",
  ORG_REQUEST_INFO_REQUESTED: "Requested more information",
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

type DialogMode = "approve" | "reject" | "request-info" | null;

export function AdminRequestDetailPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<OrgRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [reason, setReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
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

  const closeDialog = () => {
    if (submitting) return;
    setDialogMode(null);
    setReason("");
    setInternalNote("");
    setFormError(null);
  };

  const handleApprove = async () => {
    if (!requestId) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await adminApi.approveOrgRequest(requestId);
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
                  <Button onClick={() => setDialogMode("approve")}>
                    <Check className="mr-1.5 size-4" />
                    Approve
                  </Button>
                </div>
              )}
            </div>

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

            {!isOpen && (
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

      {/* ── Approve confirm ─────────────────────────────────────────────── */}
      <Dialog
        open={dialogMode === "approve"}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve this request?</DialogTitle>
            <DialogDescription>
              This creates the organization immediately and assigns the
              requester as its first organizer. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {formError && (
            <p className="text-sm text-destructive">{formError}</p>
          )}
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
