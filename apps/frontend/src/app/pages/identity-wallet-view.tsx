import { useState, useEffect } from 'react';
import { useAppContext } from '../context/app-context';
import { api } from '../../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Shield, Plus, CreditCard, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { OTPVerificationModal } from '../components/otp-verification-modal';
import { toast } from 'sonner';

// Shape returned by GET /identity/wallet
interface WalletEntry {
  identity_type: 'ORG' | 'GOV';
  identity_id: string;   // orgid or epic_id
  uid?: string;          // only for ORG
}

type AddType = 'Government' | 'Other ORG';

export function IdentityWalletView() {
  const { user } = useAppContext();

  const [wallets, setWallets]             = useState<WalletEntry[]>([]);
  const [fetching, setFetching]           = useState(true);
  const [activeId, setActiveId]           = useState<string | null>(null);

  const [showAdd, setShowAdd]             = useState(false);
  const [showOTP, setShowOTP]             = useState(false);

  const [addType, setAddType]             = useState<AddType>('Government');
  const [epicId, setEpicId]               = useState('');
  const [orgId, setOrgId]                 = useState('');
  const [uid, setUid]                     = useState('');
  const [contact, setContact]             = useState('');   // mobile/email OTP goes to
  const [submitting, setSubmitting]       = useState(false);

  // ── Fetch wallet on mount ─────────────────────────────────────────────────
  useEffect(() => {
    api.getWallet()
      .then((data: any) => setWallets(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Failed to load wallet'))
      .finally(() => setFetching(false));
  }, []);

  // ── Step 1: send OTP to the contact the user provided ────────────────────
  const handleRequestOtp = async () => {
    if (!contact.trim()) {
      toast.error('Enter the mobile/email registered with this identity');
      return;
    }
    setSubmitting(true);
    try {
      await api.sendOtp(contact.trim().toLowerCase()) as any;
      setShowOTP(true);
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to send OTP');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step 2: OTP verified → call add identity ──────────────────────────────
  const handleOtpVerified = async (otp: string) => {
    setSubmitting(true);
    try {
      const body: any = {
        identity_type: addType === 'Government' ? 'GOV' : 'ORG',
        identity_id:   addType === 'Government' ? epicId : orgId,
        identifier:    contact.trim().toLowerCase(),
        otp,
        ...(addType === 'Other ORG' && { uid }),
      };

      const newEntry = await api.addIdentity(body) as WalletEntry;
      setWallets((prev) => [...prev, newEntry]);
      toast.success('Identity added successfully!');
      resetForm();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to add identity');
    } finally {
      setSubmitting(false);
      setShowOTP(false);
    }
  };

  const resetForm = () => {
    setShowAdd(false);
    setShowOTP(false);
    setEpicId('');
    setOrgId('');
    setUid('');
    setContact('');
    setAddType('Government');
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const entryKey = (w: WalletEntry) =>
    `${w.identity_type}-${w.identity_id}${w.uid ? '-' + w.uid : ''}`;

  const entryLabel = (w: WalletEntry) =>
    w.identity_type === 'GOV'
      ? `Government — ${w.identity_id}`
      : `${w.identity_id} / ${w.uid}`;

  const canSubmit =
    (addType === 'Government' && !!epicId && !!contact) ||
    (addType === 'Other ORG' && !!orgId && !!uid && !!contact);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="mb-2">Identity Wallet</h1>
          <p className="text-muted-foreground">Manage your linked identities</p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Identity
        </Button>
      </div>

      {/* Unified account prompt (always shown for GOV/ORG-only users) */}
      {user && (
        <Card className="mb-6 bg-blue-50 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <Shield className="h-8 w-8 text-blue-600 flex-shrink-0 mt-1" />
              <div>
                <h3 className="mb-1">Unified Account</h3>
                <p className="text-sm text-muted-foreground">
                  PID: <span className="font-mono">{user.pid}</span>
                </p>
                {(user.mobile || user.email) && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {user.mobile && <span>📱 {user.mobile}</span>}
                    {user.mobile && user.email && '  ·  '}
                    {user.email && <span>✉️ {user.email}</span>}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Wallet list */}
      {fetching ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6 space-y-3">
                <div className="h-8 w-8 rounded bg-muted animate-pulse" />
                <div className="h-4 w-32 rounded bg-muted animate-pulse" />
                <div className="h-3 w-48 rounded bg-muted animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : wallets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Shield className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="mb-2">No Linked Identities</h3>
            <p className="text-muted-foreground mb-4">
              Add a Government or Organization identity to your wallet
            </p>
            <Button onClick={() => setShowAdd(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Identity
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {wallets.map((w) => {
            const key   = entryKey(w);
            const isGov = w.identity_type === 'GOV';
            return (
              <Card
                key={key}
                className={`cursor-pointer transition-all ${
                  isGov ? 'bg-blue-50 border-blue-200' : 'bg-purple-50 border-purple-200'
                } ${activeId === key ? 'ring-2 ring-[#1e40af]' : ''}`}
                onClick={() => setActiveId(key)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    {isGov
                      ? <Shield className="h-8 w-8 text-blue-600" />
                      : <CreditCard className="h-8 w-8 text-purple-600" />
                    }
                    {activeId === key && <Badge className="bg-[#1e40af]">Active</Badge>}
                  </div>
                  <CardTitle className="mt-4">
                    {isGov ? 'Government' : 'Organization'}
                  </CardTitle>
                  <CardDescription>{entryLabel(w)}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    {isGov ? (
                      <div>
                        <span className="text-muted-foreground">EPIC ID: </span>
                        <span className="font-mono">{w.identity_id}</span>
                      </div>
                    ) : (
                      <>
                        <div>
                          <span className="text-muted-foreground">Org ID: </span>
                          <span className="font-mono">{w.identity_id}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">UID: </span>
                          <span className="font-mono">{w.uid}</span>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Identity Dialog */}
      <Dialog open={showAdd} onOpenChange={(o) => { if (!o) resetForm(); else setShowAdd(true); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Identity</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">

            <div className="space-y-2">
              <Label>Identity Type</Label>
              <Select value={addType} onValueChange={(v) => setAddType(v as AddType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Government">Government (EPIC ID)</SelectItem>
                  <SelectItem value="Other ORG">Organization</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {addType === 'Government' && (
              <div className="space-y-2">
                <Label>EPIC ID <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="Enter your EPIC ID"
                  value={epicId}
                  onChange={(e) => setEpicId(e.target.value)}
                />
              </div>
            )}

            {addType === 'Other ORG' && (
              <>
                <div className="space-y-2">
                  <Label>Organization ID <span className="text-destructive">*</span></Label>
                  <Input
                    placeholder="e.g. ABC1234"
                    value={orgId}
                    onChange={(e) => setOrgId(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Your UID in that Org <span className="text-destructive">*</span></Label>
                  <Input
                    placeholder="Your personal org ID"
                    value={uid}
                    onChange={(e) => setUid(e.target.value)}
                  />
                </div>
              </>
            )}

            {/* Contact always required — OTP goes here */}
            <div className="space-y-2">
              <Label>
                Registered Mobile / Email <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="Mobile or email on file for this identity"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                OTP will be sent to this contact for verification.
              </p>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={resetForm} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={handleRequestOtp}
                disabled={!canSubmit || submitting}
                className="flex-1"
              >
                {submitting
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</>
                  : 'Verify with OTP'
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <OTPVerificationModal
        open={showOTP}
        onClose={() => setShowOTP(false)}
        onVerify={handleOtpVerified}
        contact={contact}
      />
    </div>
  );
}