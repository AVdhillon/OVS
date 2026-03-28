import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { OTPVerificationModal } from '../components/otp-verification-modal';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { useAppContext, OrgType } from '../context/app-context';
import { Shield, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';
import { ImageWithFallback } from '../components/figma/ImageWithFallback';
import { api, setToken } from '../../lib/api';
import { countryStateMap } from '../../constants/location';

export function AuthPage() {
  const navigate = useNavigate();
  const { setUser, addIdentity, setActiveIdentity } = useAppContext();

  // Register form state
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [state, setState] = useState('');
  const [country, setCountry] = useState('');

  // Login form state
  const [orgType, setOrgType] = useState<OrgType>('Unified Account');
  const [epicId, setEpicId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [personalOrgId, setPersonalOrgId] = useState('');
  const [loginContact, setLoginContact] = useState('');

  // OTP Modal state
  const [showWhatsAppHelp, setShowWhatsAppHelp] = useState(false);
  const [showOTPModal, setShowOTPModal] = useState(false);
  const [otpContact, setOTPContact] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  // Error state
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isRegisterValid = email && firstName && lastName && state && country;
  const isLoginValid =
    (orgType === 'Government' && epicId) ||
    (orgType === 'Other ORG' && organizationId && personalOrgId) ||
    (orgType === 'Unified Account' && loginContact);

  // ─── Derive the OTP identifier for each login type ─────────────────────
  // For UNIFIED: the mobile/email entered
  // For GOV / ORG: we need the user to tell us where to send the OTP.
  // The backend will validate it matches the registered contact.
  // We reuse loginContact as the "contact" field for GOV/ORG paths too —
  // the user must type in their registered mobile/email so the OTP
  // can be delivered and verified.
  function getLoginIdentifier() {
    return loginContact; // always used as the OTP delivery contact
  }

  // ─── Register: step 1 — send OTP ────────────────────────────────────────
  const handleRegister = async () => {
    setError(null);
    const identifier = email.trim().toLowerCase();
    try {
      setLoading(true);
      await api.sendOtp(identifier);
      setOTPContact(identifier);
      setIsRegistering(true);
      setShowOTPModal(true);
    } catch (e: any) {
      setError(e.message ?? 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  // ─── Login: step 1 — send OTP ───────────────────────────────────────────
  const handleLogin = async () => {
    setError(null);
    const identifier = getLoginIdentifier().trim().toLowerCase();
    if (!identifier) {
      setError('Please enter the mobile/email registered with your account');
      return;
    }
    try {
      setLoading(true);
      await api.sendOtp(identifier);
      setOTPContact(identifier);
      setIsRegistering(false);
      setShowOTPModal(true);
    } catch (e: any) {
      setError(e.message ?? 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  // ─── OTP verified: step 2 — register or login ───────────────────────────
  const handleOTPVerify = async (otp: string) => {
    setError(null);
    try {
      setLoading(true);

      if (isRegistering) {
        // ── REGISTER ──────────────────────────────────────────────────────
        const user = await api.register({
          first_name: firstName,
          middle_name: middleName || undefined,
          last_name: lastName,
          // determine whether the identifier is email or mobile
          ...(email.includes('@') ? { email: email.trim() } : { mobile: email.trim() }),
          state,
          country,
          otp,
        }) as any;

        // After registration, log the user in automatically via UNIFIED login
        const identifier = email.trim().toLowerCase();

        // Re-send OTP is NOT needed here because /users/register already
        // consumed the OTP. We issue a fresh OTP for the auto-login step.
        // However the simplest UX is: registration succeeded, ask user to login.
        // We'll set up the app context with the data we got back and skip
        // the auto-login to avoid a second OTP round-trip.
        setUser({
          pid: user.pid?.toString(),
          email: user.email ?? undefined,
          mobile: user.mobile ?? undefined,
          firstName: user.first_name,
          middleName: user.middle_name ?? undefined,
          lastName: user.last_name,
          state,
          country,
        });

        const identity = {
          id: user.pid?.toString(),
          type: 'Unified Account' as OrgType,
          displayName: `${user.first_name} ${user.last_name}`,
          email: user.email ?? undefined,
        };
        addIdentity(identity);
        setActiveIdentity(identity);

        setShowOTPModal(false);
        navigate('/dashboard');

      } else {
        // ── LOGIN ─────────────────────────────────────────────────────────
        const identifier = getLoginIdentifier().trim().toLowerCase();

        let loginBody: object;
        if (orgType === 'Government') {
          loginBody = { type: 'GOV', identifier, otp, epic_id: epicId };
        } else if (orgType === 'Other ORG') {
          loginBody = { type: 'ORG', identifier, otp, orgid: organizationId, uid: personalOrgId };
        } else {
          loginBody = { type: 'UNIFIED', identifier, otp };
        }

        const { access_token } = await api.login(loginBody);
        setToken(access_token);

        // Fetch real profile from the server
        const profile = await api.getMe() as any;

        setUser({
          pid: profile.pid?.toString(),
          email: profile.email ?? undefined,
          mobile: profile.mobile ?? undefined,
          firstName: profile.first_name,
          middleName: profile.middle_name ?? undefined,
          lastName: profile.last_name,
          state: profile.state ?? undefined,
          country: profile.country ?? undefined,
        });

        // Build identity entry from login type
        let identity;
        if (orgType === 'Government') {
          identity = {
            id: `GOV-${epicId}`,
            type: orgType as OrgType,
            epicId,
            displayName: `Government - ${epicId}`,
          };
        } else if (orgType === 'Other ORG') {
          identity = {
            id: `${organizationId}-${personalOrgId}`,
            type: orgType as OrgType,
            orgId: organizationId,
            personalOrgId,
            displayName: `${organizationId} - ${personalOrgId}`,
          };
        } else {
          identity = {
            id: profile.pid?.toString(),
            type: 'Unified Account' as OrgType,
            displayName: `${profile.first_name} ${profile.last_name}`,
            email: profile.email ?? undefined,
          };
        }
        addIdentity(identity);
        setActiveIdentity(identity);

        setShowOTPModal(false);
        navigate('/dashboard');
      }
    } catch (e: any) {
      setError(e.message ?? 'Verification failed');
      // Keep modal open so user can retry
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#1e40af] relative overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <ImageWithFallback
            src="https://images.unsplash.com/photo-1698281958513-2e09090da395?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzZWN1cmUlMjB2b3RpbmclMjB0ZWNobm9sb2d5JTIwZGlnaXRhbHxlbnwxfHx8fDE3NzMyMzcxNjN8MA&ixlib=rb-4.1.0&q=80&w=1080"
            alt="Secure voting"
            className="w-full h-full object-cover"
          />
        </div>
        <div className="relative z-10 flex flex-col justify-center items-center w-full px-12 text-white">
          <div className="flex items-center gap-3 mb-6">
            <Shield className="h-16 w-16" />
            <h1 className="text-5xl">VoteCore</h1>
          </div>
          <p className="text-xl text-center max-w-md opacity-90">
            Secure, transparent, and accessible online voting for the digital age
          </p>
          <div className="mt-12 space-y-4 max-w-md">
            {[
              { title: 'End-to-End Encryption', body: 'Your vote is secured with industry-leading encryption' },
              { title: 'Verified Identity', body: 'Multi-factor authentication ensures voting integrity' },
              { title: 'Unified Account', body: 'Link multiple identities to one secure account' },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-3">
                <div className="bg-white/20 rounded-full p-2 mt-1">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg mb-1">{item.title}</h3>
                  <p className="text-sm opacity-80">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right side - Auth forms */}
      <div className="flex-1 flex items-center justify-center p-8 bg-gray-50">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader>
            <CardTitle>Welcome to VoteCore</CardTitle>
            <CardDescription>Secure online voting platform</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Global error banner */}
            {error && (
              <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <Tabs defaultValue="login" onValueChange={() => setError(null)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Login</TabsTrigger>
                <TabsTrigger value="register">Register</TabsTrigger>
              </TabsList>

              {/* ── Login Tab ── */}
              <TabsContent value="login" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="orgType">Organization Type</Label>
                  <Select value={orgType} onValueChange={(v) => { setOrgType(v as OrgType); setError(null); }}>
                    <SelectTrigger id="orgType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Government">Government</SelectItem>
                      <SelectItem value="Other ORG">Other ORG</SelectItem>
                      <SelectItem value="Unified Account">Unified Account</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {orgType === 'Government' && (
                  <div className="space-y-2">
                    <Label htmlFor="epicId">
                      EPIC ID <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="epicId"
                      placeholder="Enter your EPIC ID"
                      value={epicId}
                      onChange={(e) => setEpicId(e.target.value)}
                    />
                  </div>
                )}

                {orgType === 'Other ORG' && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="organizationId">
                        Organization ID <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="organizationId"
                        placeholder="Enter organization ID"
                        value={organizationId}
                        onChange={(e) => setOrganizationId(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="personalOrgId">
                        Personal ORG ID <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="personalOrgId"
                        placeholder="Enter your personal ID"
                        value={personalOrgId}
                        onChange={(e) => setPersonalOrgId(e.target.value)}
                      />
                    </div>
                  </>
                )}

                {/* Contact field — always shown for OTP delivery */}
                <div className="space-y-2">
                  <Label htmlFor="loginContact">
                    {orgType === 'Unified Account'
                      ? <>Mobile Number or Email <span className="text-destructive">*</span></>
                      : <>Registered Mobile / Email (for OTP) <span className="text-destructive">*</span></>
                    }
                  </Label>
                  <Input
                    id="loginContact"
                    placeholder="Enter mobile or email"
                    value={loginContact}
                    onChange={(e) => setLoginContact(e.target.value)}
                  />
                </div>

                <div className="flex items-center gap-2">
                  {/* Main Button */}
                  <Button
                    className="flex-1"
                    onClick={handleLogin}
                    disabled={!isLoginValid || !loginContact || loading}
                  >
                    {loading ? 'Sending OTP…' : 'Send OTP'}
                  </Button>

                  {/* Info Button */}
                  {loginContact && !loginContact.includes('@') && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => setShowWhatsAppHelp(true)}
                    >
                      <Info className="h-5 w-5" />
                    </Button>
                  )}
                </div>
              </TabsContent>

              {/* ── Register Tab ── */}
              <TabsContent value="register" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="email">
                    Email or Mobile Number <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="email"
                    placeholder="your@email.com or 10-digit mobile"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">
                      First Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="firstName"
                      placeholder="First name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="middleName">Middle Name</Label>
                    <Input
                      id="middleName"
                      placeholder="Middle name"
                      value={middleName}
                      onChange={(e) => setMiddleName(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lastName">
                    Last Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="lastName"
                    placeholder="Last name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="state">
                      State <span className="text-destructive">*</span>
                    </Label>
                    <Select value={state} onValueChange={setState} disabled={!country}>
                      <SelectTrigger id="state">
                        <SelectValue placeholder={country ? "Select state" : "Select country first"} />
                      </SelectTrigger>

                      <SelectContent>
                        {countryStateMap[country]?.map((s) => (
                          <SelectItem key={s.value} value={s.value}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="country">
                      Country <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={country}
                      onValueChange={(val) => {
                        setCountry(val);
                        setState(''); // 🔥 reset state when country changes
                      }}
                    >
                      <SelectTrigger id="country">
                        <SelectValue placeholder="Select country" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USA">United States</SelectItem>
                        <SelectItem value="UK">United Kingdom</SelectItem>
                        <SelectItem value="CA">Canada</SelectItem>
                        <SelectItem value="AU">Australia</SelectItem>
                        <SelectItem value="IN">India</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-[#1e40af] mt-0.5 flex-shrink-0" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">
                          A unique Personal ID (PID) will be automatically generated for your
                          account upon successful registration
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <p className="text-sm text-blue-900">
                    A unique PID will be generated for your account
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {/* Main Button */}
                  <Button
                    className="flex-1"
                    onClick={handleRegister}
                    disabled={!isRegisterValid || loading}
                  >
                    {loading ? 'Sending OTP…' : 'Create Account'}
                  </Button>

                  {/* Info Button */}
                  {email && !email.includes('@') && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      onClick={() => setShowWhatsAppHelp(true)}
                    >
                      <Info className="h-5 w-5" />
                    </Button>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <OTPVerificationModal
        open={showOTPModal}
        onClose={() => { setShowOTPModal(false); setError(null); }}
        onVerify={handleOTPVerify}
        contact={otpContact}
      />
      <Dialog open={showWhatsAppHelp} onOpenChange={setShowWhatsAppHelp}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Using Mobile Number?  </DialogTitle>
          </DialogHeader>

          <div className="grid md:grid-cols-2 gap-6 items-center">

            {/* LEFT SIDE */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Opt-in First:</h3>

              <p className="text-sm text-gray-600">
                Send a message from your WhatsApp to:
              </p>

              <div className="font-medium text-lg flex items-center gap-2">
                📱 +1 415 523 8886
              </div>

              <div className="text-sm">
                with code <span className="font-semibold">join person-easy</span>
              </div>

              <a
                href="https://wa.me/14155238886?text=join%20person-easy"
                target="_blank"
                className="inline-block bg-blue-600 text-white px-4 py-2 rounded-md"
              >
                Open WhatsApp
              </a>
            </div>

            {/* RIGHT SIDE */}
            <div className="flex justify-center">
              <img
                src="/whatsappqr.svg" // 👈 put your QR in public folder
                alt="WhatsApp QR"
                className="w-48 h-48"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
