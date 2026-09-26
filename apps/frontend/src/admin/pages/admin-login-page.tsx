import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../app/components/ui/card";
import { Input } from "../../app/components/ui/input";
import { Label } from "../../app/components/ui/label";
import { Button } from "../../app/components/ui/button";
import { OTPVerificationModal } from "../../app/components/otp-verification-modal";
import { useAdminContext } from "../context/admin-context";
import { adminApi } from "../lib/admin-api";
import { ShieldCheck } from "lucide-react";

// EDIT (Phase 1 — auth model consolidation, subphase 1.10): admin login
// page for the standalone admin app. Same OTP-atomic-with-login shape as
// AuthPage's UNIFIED/ORG login (subphase 1.6 left those in
// src/app/pages/auth-page.tsx), just against admin_id +
// /auth/send-admin-login-otp/-admin-login instead — deliberately not
// reusing AuthPage itself, since that page's tabs/state are scoped to the
// UNIFIED/ORG login modes only (see LoginMode there) and this app has
// exactly one login mode. The OTPVerificationModal component is generic
// (contact/onVerify/onResend callbacks, no GOV/UNIFIED/ORG-specific logic
// inside it) so it's reused as-is here.
export function AdminLoginPage() {
  const navigate = useNavigate();
  const { setAdmin } = useAdminContext();

  const [adminId, setAdminId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showOTPModal, setShowOTPModal] = useState(false);
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  // FIX: admin ID an OTP is currently pending for. Lets handleSendOtp tell
  // "user accidentally closed the dialog and is reclicking the same button"
  // apart from "user actually wants a fresh OTP" (see handleSendOtp below).
  const [otpContact, setOtpContact] = useState<string | null>(null);

  const handleSendOtp = async () => {
    const identifier = adminId.trim();
    if (!identifier) {
      setError("Enter your admin ID");
      return;
    }
    setError(null);

    // FIX: an OTP is already pending for this admin ID — just reopen the
    // dialog instead of requesting a new one. Without this, clicking
    // outside the OTP dialog (which closes it, e.g. from the dev-mode OTP
    // toast) and then clicking "Send OTP" again immediately re-hits the
    // backend's 30s resend cooldown, which throws before the dialog is
    // ever reopened — the button just shows a "please wait" error with no
    // way back into the OTP entry dialog.
    if (otpContact === identifier) {
      setShowOTPModal(true);
      return;
    }

    setLoading(true);
    try {
      await adminApi.sendAdminLoginOtp(identifier);
      setOtpContact(identifier);
      setOtpSentAt(Date.now());
      setShowOTPModal(true);
    } catch (e: any) {
      setError(e?.message ?? "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (otp: string) => {
    await adminApi.adminLogin(adminId.trim(), otp);
    const profile = await adminApi.getAdminProfile();
    setAdmin(profile);
    setShowOTPModal(false);
    navigate("/dashboard");
  };

  const handleResend = async () => {
    await adminApi.sendAdminLoginOtp(adminId.trim());
    setOtpSentAt(Date.now());
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <ShieldCheck className="mb-2 size-8 text-primary" />
          <CardTitle>VoteCore Admin</CardTitle>
          <CardDescription>Sign in with your admin ID</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="admin-id">Admin ID</Label>
            <Input
              id="admin-id"
              placeholder="e.g. SA0001"
              value={adminId}
              onChange={(e) => setAdminId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSendOtp();
              }}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" onClick={handleSendOtp} disabled={loading}>
            {loading ? "Sending..." : "Send OTP"}
          </Button>
        </CardContent>
      </Card>

      <OTPVerificationModal
        open={showOTPModal}
        onClose={
          () =>
            setShowOTPModal(
              false,
            ) /* keeps otpContact — reopening resumes, doesn't resend */
        }
        onVerify={handleVerify}
        onResend={handleResend}
        contact={adminId}
        sentAt={otpSentAt}
      />
    </div>
  );
}
