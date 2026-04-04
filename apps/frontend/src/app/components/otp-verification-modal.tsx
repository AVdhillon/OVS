import {useState, useEffect, useRef, useCallback} from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {Button} from './ui/button';
import {InputOTP, InputOTPGroup, InputOTPSlot} from './ui/input-otp';
import {Loader2} from 'lucide-react';

interface OTPVerificationModalProps {
  open: boolean;
  onClose: () => void;
  onVerify: (otp: string) => Promise<void>;
  onResend: () => Promise<void>;
  contact: string;
  // FIX: epoch ms when OTP was dispatched — lets the modal resume the cooldown
  //      correctly when reopened, instead of always restarting from 30s.
  sentAt?: number | null;
}

const RESEND_COOLDOWN_SECONDS = 30;

// Returns how many cooldown seconds remain given a send timestamp.
const getRemainingCooldown = (sentAt: number | null | undefined): number => {
  if (!sentAt) return RESEND_COOLDOWN_SECONDS;
  const elapsed = Math.floor((Date.now() - sentAt) / 1000);
  return Math.max(0, RESEND_COOLDOWN_SECONDS - elapsed);
};

export function OTPVerificationModal({
                                       open,
                                       onClose,
                                       onVerify,
                                       onResend,
                                       contact,
                                       sentAt,
                                     }: OTPVerificationModalProps) {
  const [otp, setOtp]                 = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // ── Resend cooldown timer ──────────────────────────────────────────────────
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const timerRef                = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldownFrom = useCallback((seconds: number) => {
    // Clear any existing interval before starting a new one
    if (timerRef.current) clearInterval(timerRef.current);
    setCooldown(seconds);
    if (seconds <= 0) return;
    timerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    if (open) {
      // FIX: seed from real elapsed time so reopening the modal resumes the
      //      countdown from where it left off, not from 30s again.
      startCooldownFrom(getRemainingCooldown(sentAt));
    } else {
      clearInterval(timerRef.current!);
      timerRef.current = null;
      setOtp('');
      setError(null);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
    return () => clearInterval(timerRef.current!);
  }, [open, sentAt, startCooldownFrom]);
  // ^^^ sentAt in the dep array means if the parent sends a fresh OTP while
  //     the modal is already open (e.g. resend), the timer re-seeds correctly.

  // ── Verify ─────────────────────────────────────────────────────────────────
  const handleVerify = async () => {
    if (otp.length !== 6) return;
    setError(null);
    setIsVerifying(true);
    try {
      await onVerify(otp);
      setOtp('');
    } catch (e: any) {
      setError(e.message ?? 'Invalid OTP. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  // ── Resend ─────────────────────────────────────────────────────────────────
  const handleResend = async () => {
    if (cooldown > 0 || isResending) return;
    setError(null);
    setIsResending(true);
    try {
      await onResend();
      // FIX: parent updates sentAt after resend, which triggers the useEffect
      //      above to re-seed. We don't call startCooldownFrom here directly
      //      to avoid a race; the sentAt dep handles it.
      setOtp('');
    } catch (e: any) {
      setError(e.message ?? 'Failed to resend OTP. Please try again.');
    } finally {
      setIsResending(false);
    }
  };

  // ── Close ──────────────────────────────────────────────────────────────────
  const handleClose = () => {
    onClose();
  };

  return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Verify OTP</DialogTitle>
            <DialogDescription>
              Enter the 6-digit OTP sent to <span className="font-medium">{contact}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-6 py-4">
            <InputOTP
                maxLength={6}
                value={otp}
                onChange={(val) => {
                  setOtp(val);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && otp.length === 6 && !isVerifying) {
                    handleVerify();
                  }
                }}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0}/>
                <InputOTPSlot index={1}/>
                <InputOTPSlot index={2}/>
                <InputOTPSlot index={3}/>
                <InputOTPSlot index={4}/>
                <InputOTPSlot index={5}/>
              </InputOTPGroup>
            </InputOTP>

            {error && (
                <p className="text-sm text-red-600 text-center">{error}</p>
            )}

            <div className="text-sm text-muted-foreground text-center">
              {cooldown > 0 ? (
                  <span>Resend OTP in <span className="font-medium tabular-nums">{cooldown}s</span></span>
              ) : (
                  <button
                      type="button"
                      onClick={handleResend}
                      disabled={isResending}
                      className="text-primary underline-offset-4 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isResending ? 'Resending…' : 'Resend OTP'}
                  </button>
              )}
            </div>

            <div className="flex gap-3 w-full">
              <Button variant="outline" onClick={handleClose} className="flex-1">
                Cancel
              </Button>
              <Button
                  onClick={handleVerify}
                  disabled={otp.length !== 6 || isVerifying}
                  className="flex-1"
              >
                {isVerifying && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                Verify
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
  );
}