import { useEffect, useState, useCallback } from "react";
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
import { Textarea } from "../../app/components/ui/textarea";
import { Checkbox } from "../../app/components/ui/checkbox";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../app/components/ui/dialog";
import { AdminHeader } from "../components/admin-header";
import { useAdminContext } from "../context/admin-context";
import {
  adminApi,
  type SiteAdmin,
  type InviteAdminBody,
} from "../lib/admin-api";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  UserPlus,
  UserX,
  Shield,
} from "lucide-react";

// Reads/writes AdminAccountsController's four routes (invite/deactivate/
// list/getDetail). The two read routes exist because a page that lets a
// super admin *choose* who to deactivate needs a roster to read from first.
//
// Gated client-side to super-admin sessions with a notice card, mirroring
// my-org-requests-view.tsx's own non-UNIFIED notice pattern — but this is
// a courtesy, not the enforcement: every route on the backend is already
// @RequireSuperAdmin()-gated end to end (including the reads, unlike every
// other admin surface in this app — see the controller's own header
// comment for why), so an ordinary admin hitting this page directly would
// just see 403s if this notice weren't here.
const PAGE_SIZE = 25;

const STATUS_TABS: Array<{ key: string; label: string; isActive?: boolean }> = [
  { key: "all", label: "All" }, // no is_active param — backend's own no-default-filter roster
  { key: "active", label: "Active", isActive: true },
  { key: "inactive", label: "Inactive", isActive: false },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const EMPTY_INVITE_FORM: InviteAdminBody = {
  name: "",
  email: "",
  mobile: "",
  is_super_admin: false,
  reason: "",
};

export function AdminAccountsPage() {
  const { admin } = useAdminContext();

  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const [admins, setAdmins] = useState<SiteAdmin[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] =
    useState<InviteAdminBody>(EMPTY_INVITE_FORM);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [deactivateTarget, setDeactivateTarget] = useState<SiteAdmin | null>(
    null,
  );
  const [deactivateReason, setDeactivateReason] = useState("");
  const [deactivateSubmitting, setDeactivateSubmitting] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const activeTab = STATUS_TABS.find((t) => t.key === tab) ?? STATUS_TABS[0];

  const load = useCallback(async () => {
    if (!admin?.is_super_admin) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listAdminAccounts({
        isActive: activeTab.isActive,
        page,
        pageSize: PAGE_SIZE,
      });
      setAdmins(res.admins);
      setTotal(res.total);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load admin accounts");
      setAdmins([]);
    } finally {
      setLoading(false);
    }
    // activeTab is derived from `tab`, which IS in the dep array — same
    // reasoning admin-org-directory-page.tsx's own load() already uses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin?.is_super_admin, tab, page]);

  useEffect(() => {
    load();
  }, [load]);

  const handleTabChange = (next: string) => {
    setTab(next);
    setPage(1); // switching tabs resets pagination
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const closeInviteDialog = () => {
    if (inviteSubmitting) return;
    setInviteOpen(false);
    setInviteForm(EMPTY_INVITE_FORM);
    setInviteError(null);
  };

  const handleInvite = async () => {
    const name = inviteForm.name.trim();
    const email = inviteForm.email.trim();
    if (name.length < 2) {
      setInviteError("Enter a name (at least 2 characters).");
      return;
    }
    if (!email.includes("@")) {
      setInviteError("Enter a valid email address.");
      return;
    }
    setInviteSubmitting(true);
    setInviteError(null);
    try {
      const body: InviteAdminBody = {
        name,
        email,
        is_super_admin: inviteForm.is_super_admin,
      };
      if (inviteForm.mobile?.trim()) body.mobile = inviteForm.mobile.trim();
      if (inviteForm.reason?.trim()) body.reason = inviteForm.reason.trim();
      const res = await adminApi.inviteAdmin(body);
      toast.success(res.message);
      closeInviteDialog();
      setTab("all");
      setPage(1);
      await load();
    } catch (e: any) {
      setInviteError(e?.message ?? "Failed to invite admin");
    } finally {
      setInviteSubmitting(false);
    }
  };

  const closeDeactivateDialog = () => {
    if (deactivateSubmitting) return;
    setDeactivateTarget(null);
    setDeactivateReason("");
    setDeactivateError(null);
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    const reason = deactivateReason.trim();
    if (reason.length < 3) {
      setDeactivateError("Enter a reason (at least 3 characters).");
      return;
    }
    setDeactivateSubmitting(true);
    setDeactivateError(null);
    try {
      const res = await adminApi.deactivateAdmin(deactivateTarget.admin_id, {
        reason,
      });
      toast.success(res.message);
      closeDeactivateDialog();
      await load();
    } catch (e: any) {
      setDeactivateError(e?.message ?? "Failed to deactivate admin");
    } finally {
      setDeactivateSubmitting(false);
    }
  };

  if (!admin?.is_super_admin) {
    return (
      <div className="min-h-screen bg-muted/30">
        <AdminHeader />
        <div className="mx-auto max-w-3xl p-6">
          <Card>
            <CardContent className="space-y-2 py-10 text-center">
              <Shield className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="font-semibold">Admin Accounts unavailable</p>
              <p className="text-sm text-muted-foreground">
                Managing admin accounts requires a super admin session.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <AdminHeader />
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Admin Accounts</h1>
            <p className="text-sm text-muted-foreground">
              Who can sign in to this admin app, and who has super admin access.
            </p>
          </div>
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="mr-1.5 size-4" />
            Invite admin
          </Button>
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
              {activeTab.label} admins
              {total > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({total})
                </span>
              )}
            </CardTitle>
            <CardDescription>
              Newest accounts last; active accounts listed before inactive ones.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Loading...
              </p>
            ) : !admins || admins.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                <ShieldCheck className="size-8" />
                <p className="text-sm">No admin accounts in this view.</p>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Admin ID</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {admins.map((a) => (
                      <TableRow key={a.admin_id}>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {a.admin_id}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {a.email}
                        </TableCell>
                        <TableCell>
                          {a.is_super_admin ? (
                            <Badge
                              variant="outline"
                              className="border-violet-200 bg-violet-50 text-violet-700"
                            >
                              Super Admin
                            </Badge>
                          ) : (
                            <Badge variant="outline">Admin</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {a.is_active ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-200 bg-emerald-50 text-emerald-700"
                            >
                              Active
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-slate-200 bg-slate-100 text-slate-600"
                            >
                              Inactive
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(a.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          {a.is_active && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-destructive/40 text-destructive hover:bg-destructive/10"
                              onClick={() => setDeactivateTarget(a)}
                            >
                              <UserX className="mr-1.5 size-4" />
                              Deactivate
                            </Button>
                          )}
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

      {/* ── Invite admin ─────────────────────────────────────────────────── */}
      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => !open && closeInviteDialog()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a new admin</DialogTitle>
            <DialogDescription>
              They can sign in immediately afterward via the admin login OTP
              flow — no separate acceptance step, no password to set.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-name">Name</Label>
              <Input
                id="invite-name"
                value={inviteForm.name}
                onChange={(e) =>
                  setInviteForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteForm.email}
                onChange={(e) =>
                  setInviteForm((f) => ({ ...f, email: e.target.value }))
                }
                placeholder="jane@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-mobile">Mobile (optional)</Label>
              <Input
                id="invite-mobile"
                value={inviteForm.mobile}
                onChange={(e) =>
                  setInviteForm((f) => ({ ...f, mobile: e.target.value }))
                }
                placeholder="10-digit number"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="invite-super"
                checked={inviteForm.is_super_admin}
                onCheckedChange={(v) =>
                  setInviteForm((f) => ({
                    ...f,
                    is_super_admin: v === true,
                  }))
                }
              />
              <Label htmlFor="invite-super" className="font-normal">
                Grant super admin access (can invite/deactivate other admins)
              </Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-reason">Reason (optional)</Label>
              <Textarea
                id="invite-reason"
                value={inviteForm.reason}
                onChange={(e) =>
                  setInviteForm((f) => ({ ...f, reason: e.target.value }))
                }
                placeholder="e.g. New compliance team hire."
                rows={2}
              />
            </div>
            {inviteError && (
              <p className="text-sm text-destructive">{inviteError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeInviteDialog}
              disabled={inviteSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleInvite} disabled={inviteSubmitting}>
              {inviteSubmitting ? "Inviting..." : "Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Deactivate admin ─────────────────────────────────────────────── */}
      <Dialog
        open={deactivateTarget !== null}
        onOpenChange={(open) => !open && closeDeactivateDialog()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate {deactivateTarget?.name}?</DialogTitle>
            <DialogDescription>
              {deactivateTarget?.admin_id} will no longer be able to sign in to
              this admin app. There is no reactivate action — this can only be
              undone directly against the database.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="deactivate-reason">Reason</Label>
              <Textarea
                id="deactivate-reason"
                value={deactivateReason}
                onChange={(e) => setDeactivateReason(e.target.value)}
                placeholder="e.g. No longer part of the review team."
                rows={3}
              />
            </div>
            {deactivateError && (
              <p className="text-sm text-destructive">{deactivateError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDeactivateDialog}
              disabled={deactivateSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeactivate}
              disabled={deactivateSubmitting}
            >
              {deactivateSubmitting ? "Deactivating..." : "Deactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
