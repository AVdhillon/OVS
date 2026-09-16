import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { OTPVerificationModal } from "../components/otp-verification-modal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { useAppContext, type SessionType } from "../context/app-context";
import { Shield, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip";
import { ImageWithFallback } from "../components/figma/ImageWithFallback";
import { api, type LoginBody } from "../../lib/api";
import { countryStateMap } from "../../constants/location";

// EDIT (Phase 1 — auth model consolidation, subphase 1.6): GOV login tab
// removed. GOV retired platform-wide (backend narrowed LoginDto to
// 'UNIFIED' | 'ORG' in subphase 1.2; frontend's LoginType/LoginBody
// narrowed to match in subphase 1.5) — there is no longer a server-side
// login path for a third mode here.
type LoginMode = "UNIFIED" | "ORG";

export function AuthPage() {
  const navigate = useNavigate();
  const { setUser, setSession } = useAppContext();

  // ── Refs ───────────────────────────────────────────────────────────────────
  const refRegContact = useRef<HTMLInputElement>(null);
  const refFirstName = useRef<HTMLInputElement>(null);
  const refMiddleName = useRef<HTMLInputElement>(null);
  const refLastName = useRef<HTMLInputElement>(null);
  const refOrgId = useRef<HTMLInputElement>(null);
  const refUid = useRef<HTMLInputElement>(null);
  const refCountry = useRef<HTMLButtonElement>(null);
  const refState = useRef<HTMLButtonElement>(null);

  // ── Register form ──────────────────────────────────────────────────────────
  const [regContact, setRegContact] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("");

  // ── Login form ─────────────────────────────────────────────────────────────
  const [loginContact, setLoginContact] = useState("");
  const [loginMode, setLoginMode] = useState<LoginMode>("UNIFIED");
  const [orgId, setOrgId] = useState("");
  const [uid, setUid] = useState("");

  // ── OTP / UI state ─────────────────────────────────────────────────────────
  const [showOTPModal, setShowOTPModal] = useState(false);
  const [otpContact, setOtpContact] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [showWhatsAppHelp, setShowWhatsAppHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [otpActive, setOtpActive] = useState(false);

  // FIX: epoch ms when the OTP was last dispatched — passed to the modal so
  // its resend-cooldown timer is based on the real send time, not mount time.
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);

  // ── Validation ─────────────────────────────────────────────────────────────
  const isRegisterValid =
    regContact && firstName && lastName && state && country;
  const isLoginValid =
    loginMode === "UNIFIED" ? !!loginContact : !!(orgId && uid);

  // ── Enter-key helper ───────────────────────────────────────────────────────
  const focusOrSubmit =
    (
      next: React.RefObject<HTMLElement> | null,
      submitFn: () => void,
      isValid = true,
    ) =>
    (e: React.KeyboardEvent) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (next?.current) {
        next.current.focus();
      } else if (isValid) {
        submitFn();
      }
    };

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleRegister = async () => {
    setError(null);
    const identifier = regContact.trim().toLowerCase();

    if (otpActive && otpContact === identifier) {
      setIsRegistering(true);
      setShowOTPModal(true);
      return;
    }

    try {
      setLoading(true);
      await api.sendOtp(identifier);
      setOtpContact(identifier);
      setIsRegistering(true);
      setOtpActive(true);
      setOtpSentAt(Date.now()); // record exact send time
      setShowOTPModal(true);
    } catch (e: any) {
      setError(e.message ?? "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setError(null);
    try {
      setLoading(true);

      type SendOtpBody =
        | { type: "UNIFIED"; identifier: string }
        | { type: "ORG"; orgid: string; uid: string };

      let sendBody: SendOtpBody;
      let resolvedContact: string;

      if (loginMode === "UNIFIED") {
        const identifier = loginContact.trim().toLowerCase();
        if (!identifier) {
          setError("Enter your mobile or email");
          return;
        }
        sendBody = { type: "UNIFIED", identifier };
        resolvedContact = identifier;
      } else {
        sendBody = {
          type: "ORG",
          orgid: orgId.trim().toUpperCase(),
          uid: uid.trim().toUpperCase(),
        };
        resolvedContact = "your registered contact";
      }

      if (otpActive && otpContact === resolvedContact) {
        setIsRegistering(false);
        setShowOTPModal(true);
        return;
      }

      await api.sendLoginOtp(sendBody);
      setOtpContact(resolvedContact);
      setIsRegistering(false);
      setOtpActive(true);
      setOtpSentAt(Date.now()); // record exact send time
      setShowOTPModal(true);
    } catch (e: any) {
      setError(e.message ?? "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleOTPVerify = async (otp: string) => {
    if (isRegistering) {
      const identifier = regContact.trim().toLowerCase();
      const isEmail = identifier.includes("@");
      const user = await api.register({
        first_name: firstName,
        middle_name: middleName || undefined,
        last_name: lastName,
        ...(isEmail ? { email: identifier } : { mobile: identifier }),
        state,
        country,
        otp,
      });
      setUser({
        pid: user.pid,
        first_name: user.first_name,
        middle_name: user.middle_name,
        last_name: user.last_name,
        email: user.email,
        mobile: user.mobile,
        state,
        country,
      });
      setShowOTPModal(false);
      setOtpActive(false);
      setOtpSentAt(null);
      navigate("/dashboard");
    } else {
      let loginBody: LoginBody;
      if (loginMode === "UNIFIED") {
        loginBody = {
          type: "UNIFIED",
          identifier: loginContact.trim().toLowerCase(),
          otp,
        };
      } else {
        loginBody = {
          type: "ORG",
          orgid: orgId.trim().toUpperCase(),
          uid: uid.trim().toUpperCase(),
          otp,
        };
      }

      await api.login(loginBody);

      const profile = (await api.getProfile()) as any;
      setSession({
        type: profile.type,
        pid: profile.pid?.toString(),
        orgid: profile.orgid,
        uid: profile.uid,
        session_id: profile.session_id,
      });

      if (loginMode === "UNIFIED") {
        const me = await api.getMe();
        setUser({
          pid: me.pid,
          first_name: me.first_name,
          middle_name: me.middle_name,
          last_name: me.last_name,
          email: me.email,
          mobile: me.mobile,
          state: me.state,
          country: me.country,
        });
      }

      setShowOTPModal(false);
      setOtpActive(false);
      setOtpSentAt(null);
      navigate("/dashboard");
    }
  };

  const handleResendOtp = async () => {
    setOtpActive(false);
    setOtpSentAt(null);

    if (isRegistering) {
      await api.sendOtp(regContact.trim().toLowerCase());
    } else {
      type SendOtpBody =
        | { type: "UNIFIED"; identifier: string }
        | { type: "ORG"; orgid: string; uid: string };

      let sendBody: SendOtpBody;
      if (loginMode === "UNIFIED") {
        sendBody = {
          type: "UNIFIED",
          identifier: loginContact.trim().toLowerCase(),
        };
      } else {
        sendBody = {
          type: "ORG",
          orgid: orgId.trim().toUpperCase(),
          uid: uid.trim().toUpperCase(),
        };
      }
      await api.sendLoginOtp(sendBody);
    }

    setOtpActive(true);
    setOtpSentAt(Date.now()); // record the resend time as the new baseline
  };

  const contactIsPhone = (v: string): boolean => !!v && !v.includes("@");

  return (
    <div className="min-h-screen flex">
      {/* ── Left side — Branding ── */}
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
            <svg width="64" height="64" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="37" fill="#1e40af" />
              <circle
                cx="40"
                cy="40"
                r="28"
                stroke="#6B8AFF"
                strokeWidth="2.5"
                fill="none"
                strokeDasharray="158 18"
                transform="rotate(-90 40 40)"
                strokeLinecap="round"
              />
              <path
                d="M21 40 L33 52 L59 24"
                stroke="white"
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
            <h1 className="text-5xl">VoteCore</h1>
          </div>
          <p className="text-xl text-center max-w-md opacity-90">
            Secure, transparent, and accessible online voting for the digital
            age
          </p>
          <div className="mt-12 space-y-4 max-w-md">
            {[
              {
                title: "End-to-End Encryption",
                body: "Your vote is secured with industry-leading encryption",
              },
              {
                title: "Verified Identity",
                body: "Multi-factor authentication ensures voting integrity",
              },
              {
                title: "Unified Account",
                body: "Link multiple identities to one secure account",
              },
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

      {/* ── Right side — Auth forms ── */}
      <div className="flex-1 flex items-center justify-center p-8 bg-gray-50">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader>
            <CardTitle>Welcome to VoteCore</CardTitle>
            <CardDescription>Secure online voting platform</CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <Tabs
              defaultValue="login"
              onValueChange={() => {
                setError(null);
                setOtpActive(false);
                setOtpSentAt(null);
              }}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Login</TabsTrigger>
                <TabsTrigger value="register">Register</TabsTrigger>
              </TabsList>

              {/* ── Login Tab ── */}
              <TabsContent value="login" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="loginMode">Account Type</Label>
                  <Select
                    value={loginMode}
                    onValueChange={(v) => {
                      setLoginMode(v as LoginMode);
                      setError(null);
                      setOtpActive(false);
                      setOtpSentAt(null);
                    }}
                  >
                    <SelectTrigger id="loginMode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UNIFIED">Unified Account</SelectItem>
                      <SelectItem value="ORG">ORG Account</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {loginMode === "UNIFIED" && (
                  <div className="space-y-2">
                    <Label htmlFor="loginContact">
                      Mobile or Email{" "}
                      <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="loginContact"
                      placeholder="your@email.com or 10-digit mobile"
                      value={loginContact}
                      onChange={(e) => {
                        setLoginContact(e.target.value);
                        setOtpActive(false);
                        setOtpSentAt(null);
                      }}
                      onKeyDown={focusOrSubmit(null, handleLogin, isLoginValid)}
                    />
                  </div>
                )}

                {loginMode === "ORG" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="orgId">
                        Organization ID{" "}
                        <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        ref={refOrgId}
                        id="orgId"
                        placeholder="e.g. ABC1234"
                        value={orgId}
                        onChange={(e) => {
                          setOrgId(e.target.value);
                          setOtpActive(false);
                          setOtpSentAt(null);
                        }}
                        onKeyDown={focusOrSubmit(refUid, handleLogin)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="uid">
                        Your Member ID (UID){" "}
                        <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        ref={refUid}
                        id="uid"
                        placeholder="e.g. MEM001"
                        value={uid}
                        onChange={(e) => {
                          setUid(e.target.value);
                          setOtpActive(false);
                          setOtpSentAt(null);
                        }}
                        onKeyDown={focusOrSubmit(
                          null,
                          handleLogin,
                          isLoginValid,
                        )}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      OTP will be sent to your registered contact on file.
                    </p>
                  </>
                )}

                <div className="flex items-center gap-2">
                  <Button
                    className="flex-1"
                    onClick={handleLogin}
                    disabled={!isLoginValid || loading}
                  >
                    {loading
                      ? "Sending OTP…"
                      : otpActive
                        ? "Enter OTP"
                        : "Send OTP"}
                  </Button>
                  {loginMode === "UNIFIED" && contactIsPhone(loginContact) && (
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
                  <Label htmlFor="regContact">
                    Email or Mobile Number{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    ref={refRegContact}
                    id="regContact"
                    placeholder="your@email.com or 10-digit mobile"
                    value={regContact}
                    onChange={(e) => {
                      setRegContact(e.target.value);
                      setOtpActive(false);
                      setOtpSentAt(null);
                    }}
                    onKeyDown={focusOrSubmit(
                      refFirstName,
                      handleRegister,
                      !!isRegisterValid,
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">
                      First Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      ref={refFirstName}
                      id="firstName"
                      placeholder="First name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      onKeyDown={focusOrSubmit(
                        refMiddleName,
                        handleRegister,
                        !!isRegisterValid,
                      )}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="middleName">Middle Name</Label>
                    <Input
                      ref={refMiddleName}
                      id="middleName"
                      placeholder="Middle name"
                      value={middleName}
                      onChange={(e) => setMiddleName(e.target.value)}
                      onKeyDown={focusOrSubmit(
                        refLastName,
                        handleRegister,
                        !!isRegisterValid,
                      )}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lastName">
                    Last Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    ref={refLastName}
                    id="lastName"
                    placeholder="Last name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    onKeyDown={focusOrSubmit(
                      refCountry,
                      handleRegister,
                      !!isRegisterValid,
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="country">
                      Country <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={country}
                      onValueChange={(val) => {
                        setCountry(val);
                        setState("");
                        setTimeout(() => refState.current?.focus(), 0);
                      }}
                    >
                      <SelectTrigger ref={refCountry} id="country">
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
                  <div className="space-y-2">
                    <Label htmlFor="state">
                      State <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={state}
                      onValueChange={setState}
                      disabled={!country}
                    >
                      <SelectTrigger ref={refState} id="state">
                        <SelectValue
                          placeholder={
                            country ? "Select state" : "Select country first"
                          }
                        />
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
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-[#1e40af] mt-0.5 flex-shrink-0" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">
                          A unique Personal ID (PID) will be automatically
                          generated for your account upon successful
                          registration
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <p className="text-sm text-blue-900">
                    A unique PID will be generated for your account
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    className="flex-1"
                    onClick={handleRegister}
                    disabled={!isRegisterValid || loading}
                  >
                    {loading
                      ? "Sending OTP…"
                      : otpActive
                        ? "Enter OTP"
                        : "Create Account"}
                  </Button>
                  {contactIsPhone(regContact) && (
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
        onClose={() => {
          setShowOTPModal(false);
          setError(null);
        }}
        onVerify={handleOTPVerify}
        onResend={handleResendOtp}
        contact={otpContact}
        sentAt={otpSentAt} /* pass real send timestamp to modal */
      />

      <Dialog open={showWhatsAppHelp} onOpenChange={setShowWhatsAppHelp}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Using Mobile Number?</DialogTitle>
          </DialogHeader>
          <div className="grid md:grid-cols-2 gap-6 items-center">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Opt-in First:</h3>
              <p className="text-sm text-gray-600">
                Send a message from your WhatsApp to:
              </p>
              <div className="font-medium text-lg flex items-center gap-2">
                📱 +1 415 523 8886
              </div>
              <div className="text-sm">
                with code{" "}
                <span className="font-semibold">join person-easy</span>
              </div>
              <a
                href="https://wa.me/14155238886?text=join%20person-easy"
                target="_blank"
                className="inline-block bg-blue-600 text-white px-4 py-2 rounded-md"
              >
                Open WhatsApp
              </a>
            </div>
            <div className="flex justify-center">
              <img
                src="/whatsappqr.svg"
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
