import { ListSkeleton } from "../../app/components/loading-skeletons";
import { useEffect, useState, useCallback } from "react";
import { useNavigate, Link } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../app/components/ui/card";
import { Badge } from "../../app/components/ui/badge";
import { Button } from "../../app/components/ui/button";
import { Label } from "../../app/components/ui/label";
import { Textarea } from "../../app/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../app/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../../app/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../app/components/ui/dialog";
import { AdminHeader } from "../components/admin-header";
import { adminApi, type StuckOrgRequestItem } from "../lib/admin-api";
import { toast } from "sonner";
import { ArrowLeft, Clock, Undo2 } from "lucide-react";

// Admin view of requests stuck in APPROVED_PENDING_SETUP past an age
// threshold. Purely visibility plus one action — see
// OrgRequestsService.listStuckPendingSetup()'s own comment: this is not an
// automated expiry, it's a place for an admin to notice and, if they
// choose, revoke() the specific request themselves.
//
// A separate page rather than a sixth tab on AdminRequestQueuePage: this
// view's whole point is an age-threshold filter (min_hours), which the
// queue's status-only tabs have no way to express, and it surfaces
// reviewed_at (time-since-approval) rather than created_at
// (time-since-submission) as its primary date column.

const MIN_HOURS_OPTIONS = [
  { value: "0", label: "Any time" },
  { value: "24", label: "24+ hours" },
  { value: "72", label: "3+ days" },
  { value: "168", label: "7+ days" },
  { value: "720", label: "30+ days" },
];

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

export function AdminStuckRequestsPage() {
  const navigate = useNavigate();
  const [minHours, setMinHours] = useState("24");
  const [requests, setRequests] = useState<StuckOrgRequestItem[] | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<StuckOrgRequestItem | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listStuckPendingSetupRequests(
        Number(minHours),
      );
      setRequests(res.requests);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load pending-setup requests");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [minHours]);

  useEffect(() => {
    load();
  }, [load]);

  const closeDialog = () => {
    if (submitting) return;
    setRevokeTarget(null);
    setReason("");
    setInternalNote("");
    setFormError(null);
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    if (reason.trim().length < 3) {
      setFormError("Enter a reason (at least 3 characters).");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await adminApi.revokeOrgRequestApproval(
        revokeTarget.request_id,
        {
          reason: reason.trim(),
          internal_note: internalNote.trim() || undefined,
        },
      );
      toast.success(res.message);
      closeDialog();
      await load();
    } catch (e: any) {
      setFormError(e?.message ?? "Failed to revoke approval");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-muted/30">
      <AdminHeader />
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <Link
          to="/requests"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to requests
        </Link>

        <div>
          <h1 className="text-xl font-semibold">Stuck in setup</h1>
          <p className="text-sm text-muted-foreground">
            Requests approved but never finalized by the requester — nothing
            here expires automatically; revoke individually if needed.
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Clock className="size-4 text-muted-foreground" />
                Awaiting setup
                {requests && (
                  <span className="text-sm font-normal text-muted-foreground">
                    ({requests.length})
                  </span>
                )}
              </CardTitle>
              <CardDescription>
                Oldest-approved first. Sorted by how long ago they were
                approved, not when they were submitted.
              </CardDescription>
            </div>
            <Select value={minHours} onValueChange={setMinHours}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MIN_HOURS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {error && (
              <p className="mb-4 text-sm text-destructive">{error}</p>
            )}

            {loading ? (
              <ListSkeleton />
            ) : !requests || requests.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                <Clock className="size-8" />
                <p className="text-sm">
                  Nothing stuck in setup past this threshold.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>Member limit</TableHead>
                    <TableHead>Approved</TableHead>
                    <TableHead>Approved by</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => (
                    <TableRow key={r.request_id}>
                      <TableCell
                        className="cursor-pointer font-mono text-xs"
                        onClick={() => navigate(`/requests/${r.request_id}`)}
                      >
                        {r.reference_code}
                      </TableCell>
                      <TableCell
                        className="cursor-pointer font-medium"
                        onClick={() => navigate(`/requests/${r.request_id}`)}
                      >
                        {r.org_name}
                      </TableCell>
                      <TableCell>{r.admin_set_member_limit ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(r.reviewed_at)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.reviewed_by_admin_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-destructive/40 text-destructive hover:bg-destructive/10"
                          onClick={() => setRevokeTarget(r)}
                        >
                          <Undo2 className="mr-1.5 size-4" />
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Revoke approval ──────────────────────────────────────────────── */}
      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && closeDialog()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Revoke approval for {revokeTarget?.org_name}?
            </DialogTitle>
            <DialogDescription>
              The request moves to Rejected and the organization name frees
              up again. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="stuck-revoke-reason">Reason</Label>
              <Textarea
                id="stuck-revoke-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Approved 30+ days ago; setup was never completed."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stuck-revoke-internal-note">
                Internal note{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="stuck-revoke-internal-note"
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
              onClick={handleRevoke}
              disabled={submitting}
            >
              {submitting ? "Revoking..." : "Revoke approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
