// The requester's half of the flow OrgRequestsService.finalizeSetup()
// exists for on the backend. Triggered from MyOrgRequestsView's "Set up
// your organization" CTA on an APPROVED_PENDING_SETUP row.
//
// Four steps: org ID choice (with a live availability check against
// GET /org/orgid-available) → org contact email (pre-filled, OTP-reverified
// only if changed) → owner uid → review, showing the admin-set member limit
// read-only. The limit is not editable here; it only changes later through
// the member-limit increase request flow.
//
// The email step doesn't call a separate "verify" endpoint — there isn't
// one anywhere in this codebase to call. Every OTP flow here
// (auth-page.tsx, identity-wallet-view.tsx's AddIdentityDialog,
// my-org-requests-view.tsx's ResubmitOrgRequestDialog) has
// OTPVerificationModal's onVerify perform the real action directly, not a
// separate confirm-then-submit round trip. So here too: "email" is its own
// step for readability, but finalizeSetup() itself only ever fires from
// the Review step's "Complete Setup" button — either directly (email
// unchanged) or via the OTP modal that button opens (email changed),
// exactly mirroring those existing dialogs' shape. Also matches their
// error handling: a failed finalize toasts and closes the OTP modal rather
// than surfacing inline in it — same trade-off those dialogs already make,
// not a new one introduced here.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { api } from "../../lib/api";
import type { OrgRequestMine } from "../../lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Separator } from "./ui/separator";
import { OTPVerificationModal } from "./otp-verification-modal";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";

// Same formats their respective backend CHECK constraints enforce
// (organization.chk_orgid_format / org_members.chk_uid_format) — client-side
// mirrors, not the source of truth; finalizeSetup() validates for real.
const ORGID_FORMAT = /^[A-Z]{3}[0-9]{4}$/;
const UID_FORMAT = /^[A-Z0-9]{4,20}$/;

type OrgIdMode = "generate" | "preferred";
type Availability = "idle" | "checking" | "available" | "taken" | "invalid";

const STEPS = ["Org ID", "Contact Email", "Your UID", "Review"] as const;

interface Props {
  request: OrgRequestMine | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function OrgSetupWizardDialog({ request, onClose, onSuccess }: Props) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  const [orgIdMode, setOrgIdMode] = useState<OrgIdMode>("generate");
  const [orgIdInput, setOrgIdInput] = useState("");
  const [availability, setAvailability] = useState<Availability>("idle");

  const [orgEmail, setOrgEmail] = useState("");
  const [ownerUid, setOwnerUid] = useState("");

  const [otpOpen, setOtpOpen] = useState(false);
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const open = !!request;

  // Reset/prefill whenever a different request is opened for setup.
  useEffect(() => {
    if (!request) return;
    setStep(0);
    setOrgIdMode("generate");
    setOrgIdInput("");
    setAvailability("idle");
    setOrgEmail(request.org_email ?? "");
    setOwnerUid("");
    setOtpOpen(false);
    setOtpSentAt(null);
  }, [request]);

  // ── Step 0: live orgid availability check ──────────────────────────────────
  // Debounced against GET /org/orgid-available (org.controller.ts) — a
  // read-only, non-reserving check. finalizeSetup() itself still runs the
  // real, race-safe allocation at submission time (runWithUniqueOrgId), so a
  // "taken" flip between this check and Complete Setup is still possible and
  // is handled there, not here.
  useEffect(() => {
    if (orgIdMode !== "preferred") return;
    const candidate = orgIdInput.trim().toUpperCase();
    if (!candidate) {
      setAvailability("idle");
      return;
    }
    if (!ORGID_FORMAT.test(candidate)) {
      setAvailability("invalid");
      return;
    }
    setAvailability("checking");
    const timer = setTimeout(() => {
      api
        .checkOrgIdAvailable(candidate)
        .then((res) => setAvailability(res.available ? "available" : "taken"))
        .catch(() => setAvailability("idle"));
    }, 400);
    return () => clearTimeout(timer);
  }, [orgIdMode, orgIdInput]);

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(orgEmail.trim());
  // Re-verification is required only when the email actually changed from
  // what's already on the request — mirrors finalizeSetup()'s own
  // comparison (org-requests.service.ts), not an independent decision.
  const emailChanged = orgEmail.trim() !== (request?.org_email ?? "");
  const isUidValid = UID_FORMAT.test(ownerUid.trim().toUpperCase());
  const orgIdStepValid =
    orgIdMode === "generate" ||
    (ORGID_FORMAT.test(orgIdInput.trim().toUpperCase()) &&
      availability === "available");

  const canAdvance = [orgIdStepValid, isEmailValid, isUidValid, true][step];

  const handleClose = () => {
    setOtpOpen(false);
    onClose();
  };

  const buildBody = (otp?: string) => ({
    orgid_choice:
      orgIdMode === "preferred"
        ? ({
            mode: "preferred" as const,
            orgid: orgIdInput.trim().toUpperCase(),
          } as const)
        : ({ mode: "generate" as const } as const),
    org_email: orgEmail.trim(),
    org_email_otp: otp,
    owner_uid: ownerUid.trim().toUpperCase(),
  });

  const handleFinalize = async (otp?: string) => {
    if (!request) return;
    setSubmitting(true);
    try {
      const result = await api.finalizeOrgRequest(
        request.request_id,
        buildBody(otp),
      );
      toast.success(result.message);
      onSuccess();
      handleClose();
      // "Redirect into the new org" — the response's own orgid isn't a
      // route by itself in this app (no per-org URL segment), so this
      // lands where ManageOrganizationsView's own fetchOrgs() picks up the
      // organization this wizard just created: owner.pid was set on its
      // first member row (createOrganizationCore, inside finalizeSetup()),
      // so GET /org/mine already returns it on that page's next load.
      navigate("/dashboard/organizations");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to complete setup");
    } finally {
      setSubmitting(false);
      setOtpOpen(false);
    }
  };

  const handleSendOtp = async () => {
    if (!isEmailValid) {
      toast.error("Enter a valid organization email");
      return;
    }
    setSendingOtp(true);
    try {
      await api.sendOrgDomainOtp(orgEmail.trim());
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

  const handleComplete = () => {
    if (emailChanged) {
      handleSendOtp();
    } else {
      handleFinalize();
    }
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
        <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Set Up Your Organization</DialogTitle>
            <DialogDescription>
              {request.reference_code} — "{request.org_name}" was approved.
              Finish these steps to bring it online.
            </DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-1.5 mt-1">
            {STEPS.map((label, i) => (
              <div
                key={label}
                className={`h-1.5 flex-1 rounded-full ${
                  i <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </p>

          <div className="space-y-5 mt-2 min-h-[220px]">
            {/* Step 0: Org ID */}
            {step === 0 && (
              <div className="space-y-4">
                <RadioGroup
                  value={orgIdMode}
                  onValueChange={(v) => {
                    setOrgIdMode(v as OrgIdMode);
                    setAvailability("idle");
                  }}
                >
                  <div className="flex items-start gap-2">
                    <RadioGroupItem
                      value="generate"
                      id="mode-generate"
                      className="mt-1"
                    />
                    <Label htmlFor="mode-generate" className="font-normal">
                      Generate one for me
                      <span className="block text-xs text-muted-foreground font-normal">
                        We'll assign a unique Org ID automatically
                      </span>
                    </Label>
                  </div>
                  <div className="flex items-start gap-2">
                    <RadioGroupItem
                      value="preferred"
                      id="mode-preferred"
                      className="mt-1"
                    />
                    <Label htmlFor="mode-preferred" className="font-normal">
                      Choose my own
                      <span className="block text-xs text-muted-foreground font-normal">
                        Format: 3 letters + 4 digits, e.g. ACM1234
                      </span>
                    </Label>
                  </div>
                </RadioGroup>

                {orgIdMode === "preferred" && (
                  <div className="space-y-1.5">
                    <Label>Org ID</Label>
                    <Input
                      value={orgIdInput}
                      onChange={(e) =>
                        setOrgIdInput(e.target.value.toUpperCase())
                      }
                      placeholder="ACM1234"
                      maxLength={7}
                      className="font-mono uppercase max-w-xs"
                      autoFocus
                    />
                    <div className="text-xs h-4">
                      {availability === "checking" && (
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" /> Checking…
                        </span>
                      )}
                      {availability === "available" && (
                        <span className="text-emerald-700 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Available
                        </span>
                      )}
                      {availability === "taken" && (
                        <span className="text-red-600 flex items-center gap-1">
                          <XCircle className="h-3 w-3" /> Already taken
                        </span>
                      )}
                      {availability === "invalid" && orgIdInput.trim() && (
                        <span className="text-red-600">
                          Must be 3 letters + 4 digits (e.g. ACM1234)
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 1: Org contact email */}
            {step === 1 && (
              <div className="space-y-1.5">
                <Label>
                  Organization Email{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="email"
                  value={orgEmail}
                  onChange={(e) => setOrgEmail(e.target.value)}
                  placeholder="e.g. contact@acme.com"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  {emailChanged
                    ? "This is different from what you originally submitted — you'll verify a code sent here before setup completes."
                    : "Unchanged from your original request. You'll only need to re-verify this if you change it."}
                </p>
              </div>
            )}

            {/* Step 2: Owner uid */}
            {step === 2 && (
              <div className="space-y-1.5">
                <Label>
                  Your Member ID (uid){" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={ownerUid}
                  onChange={(e) => setOwnerUid(e.target.value.toUpperCase())}
                  placeholder="e.g. OWNER01"
                  className="font-mono uppercase max-w-xs"
                  maxLength={20}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  4–20 uppercase letters/numbers. This is your own identifier
                  as this organization's first member and organizer — not
                  its Org ID.
                </p>
                {ownerUid.trim() && !isUidValid && (
                  <p className="text-xs text-red-600">
                    Must be 4–20 uppercase letters or numbers
                  </p>
                )}
              </div>
            )}

            {/* Step 3: Review */}
            {step === 3 && (
              <div className="space-y-3 text-sm">
                <ReviewRow label="Organization" value={request.org_name} />
                <ReviewRow
                  label="Org ID"
                  value={
                    orgIdMode === "preferred"
                      ? orgIdInput.trim().toUpperCase()
                      : "Assigned automatically"
                  }
                  mono={orgIdMode === "preferred"}
                />
                <ReviewRow
                  label="Organization Email"
                  value={orgEmail.trim()}
                />
                <ReviewRow
                  label="Your uid"
                  value={ownerUid.trim().toUpperCase()}
                  mono
                />
                <Separator />
                <ReviewRow
                  label="Member Limit"
                  value={
                    request.admin_set_member_limit != null
                      ? `${request.admin_set_member_limit} members`
                      : "—"
                  }
                >
                  <p className="text-xs text-muted-foreground mt-1">
                    Set by the reviewing admin when your request was
                    approved. Not editable here.
                  </p>
                </ReviewRow>
              </div>
            )}
          </div>

          <DialogFooter className="mt-6 flex-row justify-between sm:justify-between">
            <Button
              variant="outline"
              onClick={step === 0 ? handleClose : () => setStep((s) => s - 1)}
              disabled={submitting}
            >
              {step === 0 ? (
                "Cancel"
              ) : (
                <>
                  <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back
                </>
              )}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canAdvance}
              >
                Next <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                onClick={handleComplete}
                disabled={submitting || sendingOtp}
              >
                {(submitting || sendingOtp) && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                {sendingOtp
                  ? "Sending code…"
                  : submitting
                    ? "Finishing setup…"
                    : "Complete Setup"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OTPVerificationModal
        open={otpOpen}
        onClose={() => setOtpOpen(false)}
        onVerify={handleFinalize}
        onResend={handleResendOtp}
        contact={orgEmail}
        sentAt={otpSentAt}
      />
    </>
  );
}

function ReviewRow({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value: string;
  mono?: boolean;
  children?: ReactNode;
}) {
  return (
    <div>
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono" : ""}>{value}</span>
      {children}
    </div>
  );
}
