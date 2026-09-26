// EDIT (Phase 4 — cutover, subphase 4.7): new page.
//
// Where a requester goes to see what happened to something they submitted
// via SubmitOrgRequestModal (4.6) — PENDING/NEEDS_INFO/APPROVED/REJECTED —
// and, for a NEEDS_INFO request specifically, to edit and resubmit it
// in place (OrgRequestsService.resubmit(), same subphase). This is also
// where a requester who got one of 4.5's transactional emails (a "needs
// info" or "rejected" notice) would actually come to act on it or read the
// admin's reason.
//
// Gated to isUnified only, matching 4.6's own SubmitOrgRequestModal gate
// (`isUnified && <Button>…</Button>` in manage-organizations-view.tsx) —
// submitting a request through this app's UI has only ever been offered to
// UNIFIED sessions, so tracking those same requests follows the same gate
// rather than introducing a new one.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAppContext } from "../context/app-context";
import { api } from "../../lib/api";
import type { OrgRequestMine } from "../../lib/api";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Separator } from "../components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../components/ui/dialog";
import { OTPVerificationModal } from "../components/otp-verification-modal";
import {
  ClipboardList,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Pencil,
  Shield,
} from "lucide-react";

// ─── Status badge ───────────────────────────────────────────────────────────

const STATUS_META: Record<
  OrgRequestMine["status"],
  { label: string; icon: React.ElementType; className: string }
> = {
  PENDING: {
    label: "Pending Review",
    icon: Clock,
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  NEEDS_INFO: {
    label: "Needs Info",
    icon: AlertCircle,
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  APPROVED: {
    label: "Approved",
    icon: CheckCircle2,
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  REJECTED: {
    label: "Rejected",
    icon: XCircle,
    className: "bg-red-50 text-red-700 border-red-200",
  },
};

function StatusBadge({ status }: { status: OrgRequestMine["status"] }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={`gap-1.5 ${meta.className}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </Badge>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ─── Resubmit Dialog ─────────────────────────────────────────────────────────
// EDIT (subphase 4.7): the edit-and-resubmit half of a NEEDS_INFO round
// trip. Same field set and same send-then-verify-IS-resubmit OTP pattern as
// 4.6's SubmitOrgRequestModal (OTPVerificationModal's onVerify calls the
// real resubmit directly, mirroring identity-wallet-view.tsx's
// AddIdentityDialog) — see that modal's own comments for why. Prefilled
// from the request being edited rather than starting blank.
function ResubmitOrgRequestDialog({
  request,
  onClose,
  onSuccess,
}: {
  request: OrgRequestMine | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [orgName, setOrgName] = useState("");
  const [orgEmail, setOrgEmail] = useState("");
  const [expectedMemberCount, setExpectedMemberCount] = useState("");
  const [justification, setJustification] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  // FIX: org email a verification code is currently pending for — see
  // handleSendOtp below.
  const [otpContact, setOtpContact] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset/prefill whenever a different request is opened for editing.
  useEffect(() => {
    if (!request) return;
    setOrgName(request.org_name);
    setOrgEmail(request.org_email ?? "");
    setExpectedMemberCount(
      request.expected_member_count != null
        ? String(request.expected_member_count)
        : "",
    );
    setJustification(request.justification ?? "");
    setOtpOpen(false);
    setOtpSentAt(null);
    setOtpContact(null);
  }, [request]);

  const open = !!request;
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(orgEmail.trim());
  // Re-verification is required any time org_email is present, even if it's
  // unchanged from the original submission — matches
  // OrgRequestsService.resubmit()'s own deliberate simplification (see that
  // method's doc comment).
  const emailChanged = orgEmail.trim() !== (request?.org_email ?? "");

  const handleClose = () => {
    setOtpOpen(false);
    setOtpContact(null);
    onClose();
  };

  const handleSubmit = async (orgEmailOtp?: string) => {
    if (!request) return;
    // FIX: `return toast.error(...)` leaks toast.error's own return value
    // (string | number, a toast id) into handleSubmit's inferred return
    // type — Promise<string | number> instead of Promise<void>, which
    // OTPVerificationModal's onVerify prop (below) requires. Split each
    // into its own toast.error(...) call followed by a bare `return;` so
    // the function stays Promise<void> (mirrors manage-organizations-view's
    // SubmitOrgRequestModal.handleSubmit — see that function's own comment).
    if (!orgName.trim()) {
      toast.error("Organization name is required");
      return;
    }
    let memberCount: number | undefined;
    if (expectedMemberCount.trim()) {
      memberCount = Number(expectedMemberCount.trim());
      if (!Number.isInteger(memberCount) || memberCount < 1) {
        toast.error("Expected member count must be a positive whole number");
        return;
      }
    }
    setSubmitting(true);
    try {
      const result = await api.resubmitOrgRequest(request.request_id, {
        org_name: orgName.trim(),
        org_email: orgEmail.trim() || undefined,
        org_email_otp: orgEmailOtp,
        expected_member_count: memberCount,
        justification: justification.trim() || undefined,
      });
      toast.success(result.message);
      onSuccess();
      handleClose();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to resubmit request");
    } finally {
      setSubmitting(false);
      setOtpOpen(false);
    }
  };

  const handleSendOtp = async () => {
    if (!orgName.trim()) return toast.error("Organization name is required");
    if (!isEmailValid) return toast.error("Enter a valid organization email");

    const email = orgEmail.trim();

    // FIX: a code is already pending for this same email — reopen the OTP
    // dialog instead of requesting a new one. Without this, accidentally
    // clicking outside the OTP dialog (which closes it, and also re-opens
    // this form dialog via `open && !otpOpen`) and then clicking "Send
    // Verification Code" again immediately re-hits the backend's 30s resend
    // cooldown, which throws before the OTP dialog is ever reopened — the
    // button just shows a "please wait" error with no way back into it.
    if (otpContact === email) {
      setOtpOpen(true);
      return;
    }

    setSendingOtp(true);
    try {
      await api.sendOrgDomainOtp(email);
      setOtpContact(email);
      setOtpSentAt(Date.now());
      setOtpOpen(true);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to send verification code");
    } finally {
      setSendingOtp(false);
    }
  };

  const handleResendOtp = async () => {
    await api.sendOrgDomainOtp(orgEmail.trim());
    setOtpSentAt(Date.now());
  };

  if (!request) return null;

  return (
    <>
      <Dialog
        open={open && !otpOpen}
        onOpenChange={(o) => {
          if (!o) handleClose();
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit &amp; Resubmit Request</DialogTitle>
            <DialogDescription>
              {request.reference_code} — make the changes the admin asked for,
              then resubmit. This edits your existing request; it won't create a
              new one.
            </DialogDescription>
          </DialogHeader>
          {request.review_note && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <p className="font-medium mb-0.5">What the admin asked:</p>
              <p className="text-amber-800">{request.review_note}</p>
            </div>
          )}
          <div className="space-y-5 mt-2">
            <div className="space-y-1.5">
              <Label>
                Organization Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Organization Email{" "}
                <span className="text-muted-foreground font-normal">
                  (optional, strengthens your request)
                </span>
              </Label>
              <Input
                type="email"
                placeholder="e.g. contact@acme.com"
                value={orgEmail}
                onChange={(e) => setOrgEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {orgEmail.trim()
                  ? "You'll verify a code sent here before resubmitting — required again even if this address hasn't changed."
                  : "If provided, you'll verify a code sent here before resubmitting."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>
                Expected Member Count{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Input
                type="number"
                min={1}
                value={expectedMemberCount}
                onChange={(e) => setExpectedMemberCount(e.target.value)}
                className="max-w-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Why does this organization need to exist?{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                rows={4}
                className="text-sm"
              />
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={submitting || sendingOtp}
            >
              Cancel
            </Button>
            {orgEmail.trim() ? (
              <Button
                onClick={handleSendOtp}
                disabled={sendingOtp || submitting}
              >
                {sendingOtp && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                {sendingOtp ? "Sending code…" : "Send Verification Code"}
              </Button>
            ) : (
              <Button onClick={() => handleSubmit()} disabled={submitting}>
                {submitting && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                {submitting ? "Resubmitting…" : "Resubmit Request"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OTPVerificationModal
        open={otpOpen}
        onClose={() => setOtpOpen(false)}
        onVerify={handleSubmit}
        onResend={handleResendOtp}
        contact={orgEmail}
        sentAt={otpSentAt}
      />

      {submitting && !otpOpen && (
        <Dialog open>
          <DialogContent className="max-w-xs text-center py-8">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground mt-3">
              Resubmitting request…
            </p>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ─── Request Card ────────────────────────────────────────────────────────────

function RequestCard({
  request,
  onEdit,
}: {
  request: OrgRequestMine;
  onEdit: (r: OrgRequestMine) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">
              {request.org_name}
            </CardTitle>
            <CardDescription className="font-mono text-xs mt-0.5">
              {request.reference_code}
            </CardDescription>
          </div>
          <StatusBadge status={request.status} />
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>
            <span className="block text-foreground/70">Submitted</span>
            {formatDate(request.created_at)}
          </div>
          <div>
            <span className="block text-foreground/70">Last updated</span>
            {formatDate(request.updated_at)}
          </div>
          {request.org_email && (
            <div className="col-span-2">
              <span className="block text-foreground/70">
                Organization Email
              </span>
              {request.org_email}
            </div>
          )}
          {request.expected_member_count != null && (
            <div>
              <span className="block text-foreground/70">Expected Members</span>
              {request.expected_member_count}
            </div>
          )}
        </div>

        {request.status === "NEEDS_INFO" && request.review_note && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <p className="font-medium mb-0.5">The admin needs more info:</p>
            <p className="text-amber-800">{request.review_note}</p>
          </div>
        )}

        {request.status === "REJECTED" && request.review_note && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900">
            <p className="font-medium mb-0.5">Reason:</p>
            <p className="text-red-800">{request.review_note}</p>
          </div>
        )}

        {request.status === "APPROVED" && request.approved_orgid && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
            Your organization is live — Org ID{" "}
            <span className="font-mono font-semibold">
              {request.approved_orgid}
            </span>
          </div>
        )}

        {request.status === "NEEDS_INFO" && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => onEdit(request)}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit &amp; Resubmit
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function MyOrgRequestsView() {
  const { session } = useAppContext();
  const navigate = useNavigate();
  const isUnified = session?.type === "UNIFIED";

  const [requests, setRequests] = useState<OrgRequestMine[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<OrgRequestMine | null>(null);

  const fetchRequests = () => {
    if (!isUnified) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .listMyOrgRequests()
      .then((data) => setRequests(data))
      .catch(() => toast.error("Failed to load your requests"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight mb-1">My Requests</h1>
        <p className="text-sm text-muted-foreground">
          Organization requests you've submitted and their review status
        </p>
      </div>

      {/* Non-UNIFIED session notice */}
      {!isUnified && (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <Shield className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="font-semibold">My Requests unavailable</p>
            <p className="text-sm text-muted-foreground">
              Requesting an organization requires a Unified account session. Log
              in with your personal mobile or email to track requests.
            </p>
          </CardContent>
        </Card>
      )}

      {isUnified && (
        <>
          {/* Loading skeleton */}
          {loading && (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <Card key={i}>
                  <CardContent className="pt-5 space-y-3">
                    <div className="h-4 w-40 rounded bg-muted animate-pulse" />
                    <div className="h-3 w-24 rounded bg-muted animate-pulse" />
                    <Separator />
                    <div className="h-3 w-full rounded bg-muted animate-pulse" />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && requests.length === 0 && (
            <Card>
              <CardContent className="py-16 text-center space-y-4">
                <div className="flex justify-center gap-3">
                  <div className="p-3 rounded-xl bg-primary/10 text-primary">
                    <ClipboardList className="h-7 w-7" />
                  </div>
                </div>
                <div>
                  <p className="font-semibold mb-1">No requests yet</p>
                  <p className="text-sm text-muted-foreground">
                    You haven't requested any organizations yet.
                  </p>
                </div>
                <Button onClick={() => navigate("/dashboard/organizations")}>
                  Request an Organization
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Request list */}
          {!loading && requests.length > 0 && (
            <div className="space-y-4">
              {requests.map((r) => (
                <RequestCard
                  key={r.request_id}
                  request={r}
                  onEdit={setEditing}
                />
              ))}
            </div>
          )}

          <ResubmitOrgRequestDialog
            request={editing}
            onClose={() => setEditing(null)}
            onSuccess={fetchRequests}
          />
        </>
      )}
    </div>
  );
}
