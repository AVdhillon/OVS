import { useEffect, useState } from 'react';
import { useAppContext } from '../context/app-context';
import type { WalletIdentity } from '../context/app-context';
import { api } from '../../lib/api';
import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Separator } from '../components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { OTPVerificationModal } from '../components/otp-verification-modal';
import { Shield, Building2, Plus, Loader2, User } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type IdentityType = 'GOV' | 'ORG';

interface AddFormState {
  identity_type: IdentityType;
  identity_id: string; // epic_id for GOV, orgid for ORG
  uid: string;         // required for ORG
  contact: string;     // mobile or email OTP is sent to
}

const EMPTY_FORM: AddFormState = {
  identity_type: 'GOV',
  identity_id: '',
  uid: '',
  contact: '',
};

// ─── Wallet Entry Card ────────────────────────────────────────────────────────

function WalletCard({ entry }: { entry: WalletIdentity }) {
  const isGov = entry.identity_type === 'GOV';
  return (
      <Card className={`transition-shadow hover:shadow-md ${isGov ? 'border-blue-200' : 'border-violet-200'}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className={`p-2 rounded-lg ${isGov ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>
              {isGov ? <Shield className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
            </div>
            <Badge
                variant="outline"
                className={`text-xs ${isGov ? 'border-blue-300 text-blue-700' : 'border-violet-300 text-violet-700'}`}
            >
              {isGov ? 'Government' : 'Organization'}
            </Badge>
          </div>
          <CardTitle className="text-sm mt-3">
            {isGov ? 'Government Identity' : entry.identity_id}
          </CardTitle>
          <CardDescription className="text-xs font-mono">
            {isGov ? entry.identity_id : `UID: ${entry.uid ?? '—'}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-1.5 text-xs">
            {isGov ? (
                <div className="flex justify-between text-muted-foreground">
                  <span>EPIC ID</span>
                  <span className="font-mono font-medium text-foreground">{entry.identity_id}</span>
                </div>
            ) : (
                <>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Org ID</span>
                    <span className="font-mono font-medium text-foreground">{entry.identity_id}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Member UID</span>
                    <span className="font-mono font-medium text-foreground">{entry.uid ?? '—'}</span>
                  </div>
                </>
            )}
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
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const set = (field: keyof AddFormState, value: string) =>
      setForm((f) => ({ ...f, [field]: value }));

  const isGov = form.identity_type === 'GOV';

  const canRequestOtp =
      form.contact.trim() !== '' &&
      form.identity_id.trim() !== '' &&
      (isGov || form.uid.trim() !== '');

  const handleClose = () => {
    setForm(EMPTY_FORM);
    setOtpOpen(false);
    onClose();
  };

  // Step 1: send OTP to the contact on file for this identity
  const handleRequestOtp = async () => {
    setSending(true);
    try {
      await api.sendOtp(form.contact.trim());
      setOtpOpen(true);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to send OTP');
    } finally {
      setSending(false);
    }
  };

  // Step 2: OTP entered → add identity
  const handleVerify = async (otp: string) => {
    setSubmitting(true);
    try {
      await api.addIdentity({
        identity_type: form.identity_type,
        identity_id: form.identity_id.trim(),
        otp,
        identifier: form.contact.trim(),
        ...(form.identity_type === 'ORG' && { uid: form.uid.trim() }),
      });

      // Re-fetch wallet to get the canonical server state
      const updated = await api.getWallet() as WalletIdentity[];
      // find the newly added entry to pass back (last match by identity_id)
      const added = updated
          .filter((w) => w.identity_id === form.identity_id.trim())
          .at(-1);

      toast.success('Identity linked successfully');
      onSuccess(added ?? { identity_type: form.identity_type, identity_id: form.identity_id.trim(), uid: form.uid.trim() || undefined });
      handleClose();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to add identity');
    } finally {
      setSubmitting(false);
      setOtpOpen(false);
    }
  };

  return (
      <>
        <Dialog open={open && !otpOpen} onOpenChange={(o) => { if (!o) handleClose(); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Link Identity</DialogTitle>
              <DialogDescription>
                Connect a Government or Organization identity to your wallet.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              {/* Identity type */}
              <div className="space-y-1.5">
                <Label>Identity Type</Label>
                <Select
                    value={form.identity_type}
                    onValueChange={(v) => setForm({ ...EMPTY_FORM, identity_type: v as IdentityType })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GOV">Government (EPIC ID)</SelectItem>
                    <SelectItem value="ORG">Organization</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* GOV: EPIC ID */}
              {isGov && (
                  <div className="space-y-1.5">
                    <Label>EPIC ID <span className="text-destructive">*</span></Label>
                    <Input
                        placeholder="Enter your EPIC ID"
                        value={form.identity_id}
                        onChange={(e) => set('identity_id', e.target.value)}
                        className="font-mono"
                        autoFocus
                    />
                  </div>
              )}

              {/* ORG: Org ID + UID */}
              {!isGov && (
                  <>
                    <div className="space-y-1.5">
                      <Label>Organization ID <span className="text-destructive">*</span></Label>
                      <Input
                          placeholder="e.g. ABC1234"
                          value={form.identity_id}
                          onChange={(e) => set('identity_id', e.target.value.toUpperCase())}
                          className="font-mono"
                          autoFocus
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Your UID in that Org <span className="text-destructive">*</span></Label>
                      <Input
                          placeholder="e.g. EMP001"
                          value={form.uid}
                          onChange={(e) => set('uid', e.target.value.toUpperCase())}
                          className="font-mono"
                      />
                    </div>
                  </>
              )}

              <Separator />

              {/* Contact for OTP */}
              <div className="space-y-1.5">
                <Label>
                  Mobile or Email on file <span className="text-destructive">*</span>
                </Label>
                <Input
                    placeholder="Registered contact for this identity"
                    value={form.contact}
                    onChange={(e) => set('contact', e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  An OTP will be sent here to verify ownership.
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" onClick={handleClose} className="flex-1">
                  Cancel
                </Button>
                <Button
                    onClick={handleRequestOtp}
                    disabled={!canRequestOtp || sending}
                    className="flex-1"
                >
                  {sending
                      ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Sending…</>
                      : 'Send OTP'
                  }
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <OTPVerificationModal
            open={otpOpen}
            onClose={() => setOtpOpen(false)}
            onVerify={handleVerify}
            contact={form.contact}
        />

        {/* Spinner overlay while submitting after OTP */}
        {submitting && (
            <Dialog open>
              <DialogContent className="max-w-xs text-center py-8">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                <p className="text-sm text-muted-foreground mt-3">Linking identity…</p>
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

  const isUnified = session?.type === 'UNIFIED';

  // Fetch wallet on mount — UNIFIED only (GOV/ORG → 403)
  useEffect(() => {
    if (!isUnified) { setLoading(false); return; }
    api.getWallet()
        .then((data) => setWallet(data as WalletIdentity[]))
        .catch(() => toast.error('Failed to load wallet'))
        .finally(() => setLoading(false));
  }, []);

  const handleAdded = (entry: WalletIdentity) => {
    api.getWallet()
        .then((data) => setWallet(data as WalletIdentity[]))
        .catch(() => setWallet([...wallet, entry]));
  };

  const govEntries = wallet.filter((w) => w.identity_type === 'GOV');
  const orgEntries = wallet.filter((w) => w.identity_type === 'ORG');

  return (
      <div className="max-w-4xl mx-auto space-y-8">

        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight mb-1">Identity Wallet</h1>
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
                  Linking identities requires a Unified account session. Log in with your
                  personal mobile or email to manage your wallet.
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
                            {[user.first_name, user.middle_name, user.last_name].filter(Boolean).join(' ')}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono mt-0.5">PID: {user.pid}</p>
                          <div className="flex gap-3 mt-1.5 flex-wrap">
                            {user.mobile && (
                                <span className="text-xs text-muted-foreground">📱 {user.mobile}</span>
                            )}
                            {user.email && (
                                <span className="text-xs text-muted-foreground">✉️ {user.email}</span>
                            )}
                          </div>
                        </div>
                        <Badge variant="outline" className="ml-auto flex-shrink-0 text-xs border-primary/30 text-primary">
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
                        <div className="p-3 rounded-xl bg-blue-100 text-blue-600">
                          <Shield className="h-7 w-7" />
                        </div>
                        <div className="p-3 rounded-xl bg-violet-100 text-violet-600">
                          <Building2 className="h-7 w-7" />
                        </div>
                      </div>
                      <div>
                        <p className="font-semibold mb-1">No linked identities</p>
                        <p className="text-sm text-muted-foreground">
                          Link a Government or Organization identity to enable voting under that identity.
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
                    {govEntries.length > 0 && (
                        <section>
                          <div className="flex items-center gap-2 mb-3">
                            <Shield className="h-4 w-4 text-blue-600" />
                            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                              Government
                            </h2>
                            <Badge variant="secondary" className="text-xs">{govEntries.length}</Badge>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {govEntries.map((w) => (
                                <WalletCard key={`${w.identity_type}-${w.identity_id}`} entry={w} />
                            ))}
                          </div>
                        </section>
                    )}

                    {orgEntries.length > 0 && (
                        <section>
                          <div className="flex items-center gap-2 mb-3">
                            <Building2 className="h-4 w-4 text-violet-600" />
                            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                              Organizations
                            </h2>
                            <Badge variant="secondary" className="text-xs">{orgEntries.length}</Badge>
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