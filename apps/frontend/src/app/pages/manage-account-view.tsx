import { useState, useEffect, useRef } from 'react';
import { useAppContext } from '../context/app-context';
import type { Session } from '../context/app-context';
import { api } from '../../lib/api';
import type { OrgSelfInfo } from '../../lib/api';
import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Separator } from '../components/ui/separator';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { countryStateMap } from '../../constants/location';
import type { UpdateMeResponse } from '../../types/users';

// ─── OTP cooldown hook ────────────────────────────────────────────────────────

function useOtpCooldown(seconds = 60) {
  const [remaining, setRemaining] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = () => {
    setRemaining(seconds);
    timer.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { clearInterval(timer.current!); return 0; }
        return r - 1;
      });
    }, 1000);
  };

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  return { remaining, start, active: remaining > 0 };
}

// ─── Section divider ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
        {children}
      </p>
  );
}

// ─── ORG session view ─────────────────────────────────────────────────────────
// An ORG session has no `user` — that's a
// UNIFIED-only object (see app-context.tsx) — so this page used to fall
// straight through to `if (!user) return null;` below and render nothing
// at all for an ORG session. This is the org-scoped counterpart: read-only
// (there's no self-service edit for an org member's own row, unlike the
// UNIFIED form below), and deliberately limited to org-identifying info
// only — uid, org id, org name, and the org's contact — nothing about
// other members or the org's internal structure, which belong to Manage
// Events / the (UNIFIED-only) Organizations tab instead.
function OrgAccountView({ session }: { session: Session }) {
  const [info, setInfo] = useState<OrgSelfInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
        .getOrgSelfInfo()
        .then((data) => {
          if (!cancelled) setInfo(data);
        })
        .catch((e: any) => {
          if (!cancelled) toast.error(e.message ?? 'Failed to load account info');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    return () => {
      cancelled = true;
    };
  }, [session.orgid, session.uid]);

  return (
      <div className="max-w-2xl mx-auto">

        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight mb-1">Account</h1>
          <p className="text-sm text-muted-foreground">Your organization membership details</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Organization Information</CardTitle>
          </CardHeader>

          <CardContent className="space-y-6">
            {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="space-y-1.5">
                        <Skeleton className="h-3.5 w-20" />
                        <Skeleton className="h-5 w-32" />
                      </div>
                  ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <SectionLabel>Organization Name</SectionLabel>
                    <p className="text-sm font-medium">{info?.org_name ?? '—'}</p>
                  </div>
                  <div className="space-y-1.5">
                    <SectionLabel>Organization ID</SectionLabel>
                    <p className="text-sm font-mono">{info?.orgid ?? session.orgid ?? '—'}</p>
                  </div>
                  <div className="space-y-1.5">
                    <SectionLabel>Your UID</SectionLabel>
                    <p className="text-sm font-mono">{info?.uid ?? session.uid ?? '—'}</p>
                  </div>
                  <div className="space-y-1.5">
                    <SectionLabel>Contact</SectionLabel>
                    <p className="text-sm">{info?.org_email ?? '—'}</p>
                  </div>
                </div>
            )}
          </CardContent>
        </Card>
      </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function ManageAccountView() {
  const { user, setUser, session } = useAppContext();

  // ── Form state — all snake_case to match User interface ──────────────────
  const [firstName, setFirstName]   = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName]     = useState('');
  const [email, setEmail]           = useState('');
  const [mobile, setMobile]         = useState('');
  const [country, setCountry]       = useState('');
  const [stateVal, setStateVal]     = useState('');

  // OTP inputs — only shown when the respective contact changes
  const [emailOtp, setEmailOtp]   = useState('');
  const [mobileOtp, setMobileOtp] = useState('');

  // Track whether each contact differs from saved value
  const emailChanged  = email  !== (user?.email  ?? '');
  const mobileChanged = mobile !== (user?.mobile ?? '');

  const [isEditing, setIsEditing]         = useState(false);
  const [saving, setSaving]               = useState(false);
  const [sendingEmailOtp, setSendingEmailOtp]   = useState(false);
  const [sendingMobileOtp, setSendingMobileOtp] = useState(false);

  const emailCooldown  = useOtpCooldown(60);
  const mobileCooldown = useOtpCooldown(60);

  // ── Seed form from context (hydrated on app boot via getMe) ──────────────
  const seedFromUser = () => {
    if (!user) return;
    setFirstName(user.first_name   ?? '');
    setMiddleName(user.middle_name ?? '');
    setLastName(user.last_name     ?? '');
    setEmail(user.email            ?? '');
    setMobile(user.mobile          ?? '');
    setCountry(user.country        ?? '');
    setStateVal(user.state         ?? '');
    setEmailOtp('');
    setMobileOtp('');
  };

  useEffect(seedFromUser, [user]);

  // ── Send OTP ──────────────────────────────────────────────────────────────
  const handleSendEmailOtp = async () => {
    if (!email.trim()) return;
    setSendingEmailOtp(true);
    try {
      await api.sendOtp(email.trim());
      toast.success('OTP sent to your new email');
      emailCooldown.start();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to send OTP');
    } finally {
      setSendingEmailOtp(false);
    }
  };

  const handleSendMobileOtp = async () => {
    if (!mobile.trim()) return;
    setSendingMobileOtp(true);
    try {
      await api.sendOtp(mobile.trim());
      toast.success('OTP sent to your new mobile');
      mobileCooldown.start();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to send OTP');
    } finally {
      setSendingMobileOtp(false);
    }
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!user) return;

    const payload: Parameters<typeof api.updateMe>[0] = {};

    if (firstName.trim()  !== (user.first_name  ?? '')) payload.first_name  = firstName.trim();
    if (middleName.trim() !== (user.middle_name ?? '')) payload.middle_name = middleName.trim() || undefined;
    if (lastName.trim()   !== (user.last_name   ?? '')) payload.last_name   = lastName.trim();
    if (country           !== (user.country     ?? '')) payload.country     = country || undefined;
    if (stateVal          !== (user.state       ?? '')) payload.state       = stateVal || undefined;

    if (emailChanged) {
      if (!emailOtp.trim()) {
        toast.error('Enter the OTP sent to your new email');
        return;
      }
      payload.email     = email.trim() || undefined;
      payload.email_otp = emailOtp.trim();
    }

    if (mobileChanged) {
      if (!mobileOtp.trim()) {
        toast.error('Enter the OTP sent to your new mobile');
        return;
      }
      payload.mobile     = mobile.trim() || undefined;
      payload.mobile_otp = mobileOtp.trim();
    }

    if (Object.keys(payload).length === 0) {
      toast.info('No changes to save');
      setIsEditing(false);
      return;
    }

    setSaving(true);
    try {
      const updated: UpdateMeResponse = await api.updateMe(payload);

      // Merge response back into context — UpdateMeResponse is snake_case
      setUser({
        ...user,
        first_name:  updated.first_name  ?? user.first_name,
        middle_name: updated.middle_name ?? user.middle_name,
        last_name:   updated.last_name   ?? user.last_name,
        email:       updated.email       ?? user.email,
        mobile:      updated.mobile      ?? user.mobile,
        country:     updated.country     ?? user.country,
        state:       updated.state       ?? user.state,
      });

      toast.success('Account updated');
      setIsEditing(false);
    } catch (err: any) {
      // 409: contact belongs to a rich (UNIFIED) account — guide to wallet
      if (
          err.message?.includes('MOBILE_ACCOUNT_EXISTS') ||
          err.message?.includes('EMAIL_ACCOUNT_EXISTS')
      ) {
        toast.error(
            'This contact is linked to another account. Use Identity Wallet to merge.',
            { duration: 6000 },
        );
      } else {
        toast.error(err.message ?? 'Failed to update account');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    seedFromUser();
    setIsEditing(false);
  };

  // ── Guard ─────────────────────────────────────────────────────────────────
  // Branch to the org-scoped read-only
  // view above before the UNIFIED-only `!user` bailout — an ORG session
  // never has `user` populated (see app-context.tsx), so without this the
  // page rendered nothing at all for that session type.
  if (session?.type === 'ORG') return <OrgAccountView session={session} />;

  if (!user) return null;

  const countryKeys = Object.keys(countryStateMap);
  const statesForCountry = country ? (countryStateMap[country] ?? []) : [];

  return (
      <div className="max-w-2xl mx-auto">

        {/* Page header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight mb-1">Account</h1>
            <p className="text-sm text-muted-foreground">Manage your personal information</p>
          </div>
          {!isEditing && (
              <Button variant="outline" onClick={() => setIsEditing(true)} className="flex-shrink-0">
                Edit Profile
              </Button>
          )}
        </div>

        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base">Personal Information</CardTitle>
              </div>
              {isEditing && (
                  <Badge variant="secondary" className="text-xs flex-shrink-0">Editing</Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-6">

            {/* ── Name ── */}
            <div>
              <SectionLabel>Name</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                      id="firstName"
                      placeholder="First name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      disabled={!isEditing}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="middleName">
                    Middle Name{' '}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                      id="middleName"
                      placeholder="Middle name"
                      value={middleName}
                      onChange={(e) => setMiddleName(e.target.value)}
                      disabled={!isEditing}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                      id="lastName"
                      placeholder="Last name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      disabled={!isEditing}
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* ── Location ── */}
            <div>
              <SectionLabel>Location</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="country">Country</Label>
                  <Select
                      value={country}
                      onValueChange={(v) => { setCountry(v); setStateVal(''); }}
                      disabled={!isEditing}
                  >
                    <SelectTrigger id="country">
                      <SelectValue placeholder="Select country" />
                    </SelectTrigger>
                    <SelectContent>
                      {countryKeys.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="state">State / Province</Label>
                  <Select
                      value={stateVal}
                      onValueChange={setStateVal}
                      disabled={!isEditing || !country || statesForCountry.length === 0}
                  >
                    <SelectTrigger id="state">
                      <SelectValue
                          placeholder={
                            !country
                                ? 'Select country first'
                                : statesForCountry.length === 0
                                    ? 'No states available'
                                    : 'Select state'
                          }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {statesForCountry.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            {/* ── Contact ── */}
            <div>
              <SectionLabel>Contact</SectionLabel>
              <div className="space-y-4">

                {/* Email */}
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                    <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          setEmailOtp('');
                        }}
                        disabled={!isEditing}
                        className="min-w-0 flex-1 basis-40"
                    />
                    {isEditing && emailChanged && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleSendEmailOtp}
                            disabled={sendingEmailOtp || emailCooldown.active || !email.trim()}
                            className="flex-shrink-0 min-w-24"
                        >
                          {sendingEmailOtp
                              ? 'Sending…'
                              : emailCooldown.active
                                  ? `${emailCooldown.remaining}s`
                                  : 'Send OTP'}
                        </Button>
                    )}
                  </div>
                  {isEditing && emailChanged && (
                      <Input
                          placeholder="Enter email OTP"
                          value={emailOtp}
                          onChange={(e) => setEmailOtp(e.target.value)}
                          maxLength={6}
                          autoComplete="one-time-code"
                          inputMode="numeric"
                          className="max-w-48 font-mono tracking-widest"
                      />
                  )}
                </div>

                {/* Mobile */}
                <div className="space-y-1.5">
                  <Label htmlFor="mobile">Mobile <span className="text-muted-foreground font-normal text-xs">(10 digits)</span></Label>
                  <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                    <Input
                        id="mobile"
                        type="tel"
                        placeholder="9876543210"
                        value={mobile}
                        onChange={(e) => {
                          setMobile(e.target.value.replace(/\D/g, '').slice(0, 10));
                          setMobileOtp('');
                        }}
                        disabled={!isEditing}
                        maxLength={10}
                        className="flex-1 font-mono"
                    />
                    {isEditing && mobileChanged && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleSendMobileOtp}
                            disabled={sendingMobileOtp || mobileCooldown.active || mobile.length !== 10}
                            className="flex-shrink-0 min-w-24"
                        >
                          {sendingMobileOtp
                              ? 'Sending…'
                              : mobileCooldown.active
                                  ? `${mobileCooldown.remaining}s`
                                  : 'Send OTP'}
                        </Button>
                    )}
                  </div>
                  {isEditing && mobileChanged && (
                      <Input
                          placeholder="Enter mobile OTP"
                          value={mobileOtp}
                          onChange={(e) => setMobileOtp(e.target.value)}
                          maxLength={6}
                          autoComplete="one-time-code"
                          inputMode="numeric"
                          className="max-w-48 font-mono tracking-widest"
                      />
                  )}
                </div>

                {/* 409 hint — shown only when editing contacts */}
                {isEditing && (emailChanged || mobileChanged) && (
                    <p className="text-xs text-muted-foreground">
                      If a contact belongs to another account, you'll be guided to link it via your{' '}
                      <span className="font-medium text-foreground">Identity Wallet</span>.
                    </p>
                )}
              </div>
            </div>

            {/* ── Actions ── */}
            {isEditing && (
                <>
                  <Separator />
                  <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row">
                    <Button onClick={handleSave} disabled={saving}>
                      {saving ? 'Saving…' : 'Save Changes'}
                    </Button>
                    <Button variant="outline" onClick={handleCancel} disabled={saving}>
                      Cancel
                    </Button>
                  </div>
                </>
            )}
          </CardContent>
        </Card>
      </div>
  );
}