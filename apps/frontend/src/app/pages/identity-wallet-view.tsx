import { useEffect, useState } from "react";
import { useAppContext } from "../context/app-context";
import type { WalletIdentity } from "../context/app-context";
import { api } from "../../lib/api";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardHeader,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { OTPVerificationModal } from "../components/otp-verification-modal";
import { Shield, Building2, Plus, Loader2, User } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

// Wallet entries are ORG-only, so there's no identity-type choice to make
// in this form — Org ID + UID are the only fields left.
interface AddFormState {
  identity_id: string; // orgid
  uid: string; // member UID in that org
  contact: string; // mobile or email OTP is sent to
}

const EMPTY_FORM: AddFormState = {
  identity_id: "",
  uid: "",
  contact: "",
};

// ─── Wallet Entry Card ────────────────────────────────────────────────────────

// EDIT (tenant portal intuitiveness, item 3): Org ID + UID used to be shown
// three times on this card — once in CardTitle/CardDescription, then again
// as labeled rows in the body. Kept the labeled rows (clearest for someone
// scanning several cards) as the single source of truth, and replaced the
// title/description pairing with just the "Organization" badge context —
// nothing left up top that only repeats the body below it.
function WalletCard({ entry }: { entry: WalletIdentity }) {
  return (
    <Card className="transition-shadow hover:shadow-md border-violet-200">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="p-2 rounded-lg bg-violet-100 text-violet-700">
            <Building2 className="h-5 w-5" />
          </div>
          <Badge
            variant="outline"
            className="text-xs border-violet-300 text-violet-700"
          >
            Organization
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between text-muted-foreground">
            <span>Org ID</span>
            <span className="font-mono font-medium text-foreground">
              {entry.identity_id}
            </span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Member UID</span>
            <span className="font-mono font-medium text-foreground">
              {entry.uid ?? "—"}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Add Identity Dialog ──────────────────────────────────────────────────────

function AddIdentityDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: (entry: WalletIdentity) => void;
}) {
  const [form, setForm] = useState<AddFormState>(EMPTY_FORM);
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  // FIX: contact an OTP is currently pending for — see handleRequestOtp
  // below.
  const [otpContact, setOtpContact] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const set = (field: keyof AddFormState, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const canRequestOtp =
    form.contact.trim() !== "" &&
    form.identity_id.trim() !== "" &&
    form.uid.trim() !== "";

  const handleClose = () => {
    setForm(EMPTY_FORM);
    setOtpOpen(false);
    setOtpSentAt(null);
    setOtpContact(null);
    onClose();
  };

  // Step 1: send OTP to the contact on file for this identity
  const handleRequestOtp = async () => {
    const contact = form.contact.trim();

    // FIX: an OTP is already pending for this same contact — reopen the OTP
    // dialog instead of requesting a new one. Without this, accidentally
    // clicking outside the OTP dialog (which closes it, and also re-opens
    // this form dialog via `open && !otpOpen`) and then clicking "Send OTP"
    // again immediately re-hits the backend's 30s resend cooldown, which
    // throws before the OTP dialog is ever reopened — the button just shows
    // a "failed to send" error with no way back into it.
    if (otpContact === contact) {
      setOtpOpen(true);
      return;
    }

    setSending(true);
    try {
      await api.sendOtp(contact);
      setOtpContact(contact);
      setOtpSentAt(Date.now());
      setOtpOpen(true);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to send OTP");
    } finally {
      setSending(false);
    }
  };

  // Resend: same contact, fresh code — refreshes sentAt so the modal's
  // cooldown timer restarts correctly.
  const handleResendOtp = async () => {
    await api.sendOtp(form.contact.trim());
    setOtpSentAt(Date.now());
  };

  // Step 2: OTP entered → add identity
  const handleVerify = async (otp: string) => {
    setSubmitting(true);
    try {
      await api.addIdentity({
        identity_type: "ORG",
        identity_id: form.identity_id.trim(),
        otp,
        identifier: form.contact.trim(),
        uid: form.uid.trim(),
      });

      // Re-fetch wallet to get the canonical server state
      const updated = (await api.getWallet()) as WalletIdentity[];
      // find the newly added entry to pass back (last match by identity_id)
      const added = updated
        .filter((w) => w.identity_id === form.identity_id.trim())
        .at(-1);

      toast.success("Identity linked successfully");
      onSuccess(
        added ?? {
          identity_type: "ORG",
          identity_id: form.identity_id.trim(),
          uid: form.uid.trim(),
        },
      );
      handleClose();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to add identity");
    } finally {
      setSubmitting(false);
      setOtpOpen(false);
    }
  };

  return (
    <>
      <Dialog
        open={open && !otpOpen}
        onOpenChange={(o) => {
          if (!o) handleClose();
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Link Identity</DialogTitle>
            <DialogDescription>
              Connect an Organization identity to your wallet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {/* Org ID + UID */}
            <div className="space-y-1.5">
              <Label>
                Organization ID <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. ABC1234"
                value={form.identity_id}
                onChange={(e) =>
                  set("identity_id", e.target.value.toUpperCase())
                }
                className="font-mono"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Your UID in that Org <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. EMP001"
                value={form.uid}
                onChange={(e) => set("uid", e.target.value.toUpperCase())}
                className="font-mono"
              />
            </div>

            <Separator />

            {/* Contact for OTP */}
            <div className="space-y-1.5">
              <Label>
                Mobile or Email on file{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="Registered contact for this identity"
                value={form.contact}
                onChange={(e) => set("contact", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                An OTP will be sent here to verify ownership.
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                onClick={handleClose}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleRequestOtp}
                disabled={!canRequestOtp || sending}
                className="flex-1"
              >
                {sending ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Sending…
                  </>
                ) : (
                  "Send OTP"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <OTPVerificationModal
        open={otpOpen}
        onClose={() => setOtpOpen(false)}
        onVerify={handleVerify}
        onResend={handleResendOtp}
        contact={form.contact}
        sentAt={otpSentAt}
      />

      {/* Spinner overlay while submitting after OTP */}
      {submitting && (
        <Dialog open>
          <DialogContent className="max-w-xs text-center py-8">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground mt-3">
              Linking identity…
            </p>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function IdentityWalletView() {
  const { user, wallet, setWallet, session } = useAppContext();
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const isUnified = session?.type === "UNIFIED";

  // Fetch wallet on mount — UNIFIED only (ORG/SITEADMIN sessions → 403)
  useEffect(() => {
    if (!isUnified) {
      setLoading(false);
      return;
    }
    api
      .getWallet()
      .then((data) => setWallet(data as WalletIdentity[]))
      .catch(() => toast.error("Failed to load wallet"))
      .finally(() => setLoading(false));
  }, []);

  const handleAdded = (entry: WalletIdentity) => {
    api
      .getWallet()
      .then((data) => setWallet(data as WalletIdentity[]))
      .catch(() => setWallet([...wallet, entry]));
  };

  // Wallet entries are ORG-only, so every entry is an org entry.
  const orgEntries = wallet;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">
            Identity Wallet
          </h1>
          <p className="text-sm text-muted-foreground">
            Linked identities associated with your unified account
          </p>
        </div>
        {isUnified && (
          <Button onClick={() => setAddOpen(true)} className="flex-shrink-0">
            <Plus className="mr-2 h-4 w-4" />
            Link Identity
          </Button>
        )}
      </div>

      {/* Non-UNIFIED session notice */}
      {!isUnified && (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <Shield className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="font-semibold">Identity Wallet unavailable</p>
            <p className="text-sm text-muted-foreground">
              Linking identities requires a Unified account session. Log in with
              your personal mobile or email to manage your wallet.
            </p>
          </CardContent>
        </Card>
      )}

      {isUnified && (
        <>
          {/* Unified account card */}
          {user && (
            <Card className="border-primary/20 bg-primary/[0.03]">
              <CardContent className="pt-5 pb-5">
                <div className="flex items-center gap-4">
                  <div className="p-2.5 rounded-full bg-primary/10 text-primary flex-shrink-0">
                    <User className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-tight">
                      {[user.first_name, user.middle_name, user.last_name]
                        .filter(Boolean)
                        .join(" ")}
                    </p>
                    <div className="flex gap-3 mt-1.5 flex-wrap">
                      {user.mobile && (
                        <span className="text-xs text-muted-foreground">
                          📱 {user.mobile}
                        </span>
                      )}
                      {user.email && (
                        <span className="text-xs text-muted-foreground">
                          ✉️ {user.email}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className="ml-auto flex-shrink-0 text-xs border-primary/30 text-primary"
                  >
                    Unified
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardContent className="pt-5 space-y-3">
                    <div className="h-9 w-9 rounded-lg bg-muted animate-pulse" />
                    <div className="h-4 w-28 rounded bg-muted animate-pulse" />
                    <div className="h-3 w-20 rounded bg-muted animate-pulse" />
                    <Separator />
                    <div className="h-3 w-full rounded bg-muted animate-pulse" />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && wallet.length === 0 && (
            <Card>
              <CardContent className="py-16 text-center space-y-4">
                <div className="flex justify-center gap-3">
                  <div className="p-3 rounded-xl bg-violet-100 text-violet-600">
                    <Building2 className="h-7 w-7" />
                  </div>
                </div>
                <div>
                  <p className="font-semibold mb-1">No linked identities</p>
                  <p className="text-sm text-muted-foreground">
                    Link an Organization identity to enable voting under that
                    identity.
                  </p>
                </div>
                <Button onClick={() => setAddOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Link Identity
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Identity groups */}
          {!loading && wallet.length > 0 && (
            <div className="space-y-6">
              {orgEntries.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="h-4 w-4 text-violet-600" />
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      Organizations
                    </h2>
                    <Badge variant="secondary" className="text-xs">
                      {orgEntries.length}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {orgEntries.map((w) => (
                      <WalletCard
                        key={`${w.identity_type}-${w.identity_id}-${w.uid}`}
                        entry={w}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          <AddIdentityDialog
            open={addOpen}
            onClose={() => setAddOpen(false)}
            onSuccess={handleAdded}
          />
        </>
      )}
    </div>
  );
}
