import { ListSkeleton } from "../components/loading-skeletons";
import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../../lib/api";
import type { MemberRole, OrgMemberWithRoles } from "../../lib/api";
// MemberLimitTab's own history type.
import type { MemberLimitRequestRow } from "../../lib/api";
// Brings in the requester's own org-request history so the "Request
// Org" flow can pre-check eligibility (cooldown, an already-open request
// for the same name) instead of only finding out at submit time — see
// SubmitOrgRequestModal's own comments below.
import type { OrgRequestMine } from "../../lib/api";
import { useAppContext } from "../context/app-context";
import type { OrgSummary, ScopeNode } from "../context/app-context";
import { toast } from "sonner";
import { useSearchParams } from "react-router";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Separator } from "../components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover";
import { Textarea } from "../components/ui/textarea";
import { Checkbox } from "../components/ui/checkbox";
// The
// member-limit tab's usage bar.
import { Progress } from "../components/ui/progress";
import {
  Search,
  X,
  ChevronRight,
  ArrowLeftRight,
  Trash2,
  Pencil,
  Plus,
  RefreshCw,
  Users,
  TriangleAlert,
  UserPlus,
  ChevronDown,
  Loader2,
  ArrowLeft,
  Building2,
  Copy,
  Check,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  Network,
  Gauge,
} from "lucide-react";
import React from "react";
// The request-submit flow's optional
// org-email verification step reuses this generic OTP modal — same
// component auth-page.tsx/identity-wallet-view.tsx already use for their
// own send-then-verify flows, not a new one.
import { OTPVerificationModal } from "../components/otp-verification-modal";

// Use OrgMemberWithRoles from api.tsx instead of redefining a local OrgMember.
// This removes the stale local type and ensures the cast in fetchMembers is no longer needed.
type OrgMember = OrgMemberWithRoles;

// ─── Role helpers ─────────────────────────────────────────────────────────────
const hasVoter = (m: OrgMember) => m.roles.some((r) => r.is_voter);
const hasOrganizer = (m: OrgMember) => m.roles.some((r) => r.is_organizer);
const roleLabel = (r: MemberRole) =>
  r.is_voter && r.is_organizer
    ? "V+O"
    : r.is_voter
      ? "V"
      : r.is_organizer
        ? "O"
        : "None";

// ─── CSV helpers ──────────────────────────────────────────────────────────────
function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const vals = line.split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = vals[i] ?? ""));
    return row;
  });
}

function generateOrgId(name: string): string {
  const prefix = name
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, "X");
  return `${prefix}${Math.floor(1000 + Math.random() * 9000)}`;
}

// ─── Scope helpers ────────────────────────────────────────────────────────────
function flattenTree(nodes: ScopeNode[]): ScopeNode[] {
  const result: ScopeNode[] = [];
  const walk = (list: ScopeNode[]) =>
    list.forEach((n) => {
      result.push(n);
      if (n.children?.length) walk(n.children);
    });
  walk(nodes);
  return result;
}

// ─── ScopeTreeSelect ──────────────────────────────────────────────────────────
function ScopeTreeSelectNode({
  node,
  depth,
  value,
  onSelect,
  exclude = [],
}: {
  node: ScopeNode;
  depth: number;
  value: string;
  onSelect: (v: string) => void;
  exclude?: number[];
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isSelected = value === String(node.scope_id);
  const isDisabled = exclude.includes(node.scope_id);
  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1.5 rounded-md text-sm select-none transition-colors
          ${isDisabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
          ${isSelected ? "bg-primary text-primary-foreground" : isDisabled ? "text-muted-foreground" : "hover:bg-accent text-foreground"}`}
        style={{ paddingLeft: `${depth * 14 + 6}px`, paddingRight: 6 }}
        onClick={() => {
          if (!isDisabled) onSelect(String(node.scope_id));
        }}
      >
        {hasChildren ? (
          <button
            className={`flex-shrink-0 w-4 h-4 flex items-center justify-center transition-transform
              ${isSelected ? "text-primary-foreground/70" : "text-muted-foreground hover:text-foreground"}`}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((o) => !o);
            }}
          >
            <ChevronRight
              className={`w-3.5 h-3.5 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}
        <span className="truncate flex-1">
          {node.scope_name}
          {isDisabled ? " (current)" : ""}
        </span>
      </div>
      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <ScopeTreeSelectNode
            key={child.scope_id}
            node={child}
            depth={depth + 1}
            value={value}
            onSelect={onSelect}
            exclude={exclude}
          />
        ))}
    </div>
  );
}

function ScopeTreeSelect({
  scopeTree,
  flatScopes,
  value,
  onChange,
  placeholder = "Select scope",
  allowAll = false,
  allowKeep = false,
  exclude = [],
  className = "",
}: {
  scopeTree: ScopeNode[];
  flatScopes: ScopeNode[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  allowAll?: boolean;
  allowKeep?: boolean;
  exclude?: number[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const displayName =
    value === "all"
      ? "All scopes"
      : value === "keep"
        ? "Keep current scope"
        : (flatScopes.find((s) => String(s.scope_id) === value)?.scope_name ??
          placeholder);
  const isDefault = !value || value === "all" || value === "keep";
  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`justify-between font-normal ${className}`}
        >
          <span
            className={`truncate ${isDefault ? "text-muted-foreground" : ""}`}
          >
            {displayName}
          </span>
          <ChevronDown
            className={`ml-2 w-3.5 h-3.5 flex-shrink-0 text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-1 w-56" align="start" sideOffset={4}>
        <div className="max-h-64 overflow-y-auto">
          {allowAll && (
            <>
              <div
                className={`py-1.5 px-2.5 rounded-md cursor-pointer text-sm transition-colors
                  ${value === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                onClick={() => handleSelect("all")}
              >
                All scopes
              </div>
              <div className="my-1 border-t" />
            </>
          )}
          {allowKeep && (
            <>
              <div
                className={`py-1.5 px-2.5 rounded-md cursor-pointer text-sm transition-colors
                  ${value === "keep" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
                onClick={() => handleSelect("keep")}
              >
                Keep current scope
              </div>
              <div className="my-1 border-t" />
            </>
          )}
          {scopeTree.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2.5 py-2">
              No scopes available
            </p>
          ) : (
            scopeTree.map((node) => (
              <ScopeTreeSelectNode
                key={node.scope_id}
                node={node}
                depth={0}
                value={value}
                onSelect={handleSelect}
                exclude={exclude}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── ScopeTreeNode (scope management sidebar) ─────────────────────────────────
function ScopeTreeNode({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: ScopeNode;
  depth: number;
  selectedId: number | null;
  onSelect: (n: ScopeNode) => void;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedId === node.scope_id;
  return (
    <div>
      <div
        className={`group flex items-center gap-1.5 py-1.5 px-2 rounded-md cursor-pointer transition-colors text-sm
          ${isSelected ? "bg-primary text-primary-foreground" : "hover:bg-accent text-foreground"}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(node)}
      >
        {hasChildren ? (
          <button
            className={`flex-shrink-0 w-4 h-4 flex items-center justify-center rounded transition-transform
              ${isSelected ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            <ChevronRight
              className={`w-3.5 h-3.5 transition-transform duration-150 ${open ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}
        <span className="flex-1 truncate font-medium">{node.scope_name}</span>
        {isSelected && (
          <Users className="w-3.5 h-3.5 flex-shrink-0 text-primary-foreground/70" />
        )}
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map((child) => (
            <ScopeTreeNode
              key={child.scope_id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Submit Org Request Modal ──────────────────────────────────────────────────
// Organization creation is not instant: this submits an org_requests row
// (OrgRequestsService.submit(), via POST /org/request) that a site admin
// reviews in the admin portal. Approval, followed by the requester's own
// setup step, is what creates the organization. Accordingly this form does
// not collect preferred_orgid/caller_uid/caller_identifier/participants —
// SubmitOrgRequestDto has none of those (see that DTO's comment: there is
// nothing to be a member of, and no orgid to pick, until a request is
// approved).
// Mirrors org-requests.service.ts's own constants (SUBMIT_COOLDOWN_MS,
// MEMBER_COUNT_RISK_THRESHOLD, FREE_EMAIL_DOMAINS) so this form can warn the
// requester about the same things the backend already silently checks,
// instead of only surfacing them as a 429/toast after the fact or as a flag
// only the reviewing admin ever sees. These are UX nudges, not a security
// boundary — the backend re-checks everything itself regardless of what
// this form does or doesn't catch. Keep in sync with the backend file by
// hand; there's no shared package these two projects both pull from.
const SUBMIT_COOLDOWN_MS = 15 * 60 * 1000; // matches SUBMIT_COOLDOWN_MS
const MEMBER_COUNT_RISK_THRESHOLD = 50; // matches MEMBER_COUNT_RISK_THRESHOLD
const OPEN_ORG_REQUEST_STATUSES = new Set(["PENDING", "NEEDS_INFO"]);
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "protonmail.com",
  "proton.me",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "gmx.com",
  "rediffmail.com",
]);

function isFreeEmailDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && FREE_EMAIL_DOMAINS.has(domain);
}

function formatCooldownRemaining(msRemaining: number): string {
  const minutes = Math.max(1, Math.ceil(msRemaining / 60000));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function SubmitOrgRequestModal({
  open,
  onClose,
  onSuccess,
  myRequests,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  // The requester's own request history, passed down from
  // ManageOrganizationsView (already fetched there for the cooldown check
  // that gates the "Request Org" button itself) — reused here for the
  // open-name duplicate warning below, so this one fetch covers both.
  myRequests: OrgRequestMine[];
}) {
  // A short explainer screen before the form itself — "intro" is
  // shown first every time the dialog opens (reset in handleClose below),
  // "form" is the existing fields. Reframes clicking "Request Org" from an
  // instant form-fill into a deliberate two-step action without actually
  // adding a field or a round trip.
  const [step, setStep] = useState<"intro" | "form">("intro");
  const [orgName, setOrgName] = useState("");
  const [orgEmail, setOrgEmail] = useState("");
  const [expectedMemberCount, setExpectedMemberCount] = useState("");
  const [justification, setJustification] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  // Org email a verification code is currently pending for — see
  // handleSendOtp below.
  const [otpContact, setOtpContact] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(orgEmail.trim());
  const memberCountNum = Number(expectedMemberCount.trim());
  const memberCountAboveThreshold =
    expectedMemberCount.trim() !== "" &&
    Number.isInteger(memberCountNum) &&
    memberCountNum > MEMBER_COUNT_RISK_THRESHOLD;

  // Mirrors org-requests.service.ts's own findOpenRequestByName() —
  // same case-insensitive match against this requester's currently-open
  // (PENDING/NEEDS_INFO) requests. Surfaced as the user types instead of
  // only as a 409 after they've filled in the whole form.
  const duplicateOpenRequest = myRequests.find(
    (r) =>
      OPEN_ORG_REQUEST_STATUSES.has(r.status) &&
      r.org_name.trim().toLowerCase() === orgName.trim().toLowerCase(),
  );

  const resetForm = () => {
    setStep("intro");
    setOrgName("");
    setOrgEmail("");
    setExpectedMemberCount("");
    setJustification("");
    setOtpOpen(false);
    setOtpSentAt(null);
    setOtpContact(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Does the actual submit — called directly when no org_email was given,
  // or as the OTP modal's onVerify once a domain-ownership code has been
  // entered (mirrors identity-wallet-view.tsx's AddIdentityDialog: the OTP
  // modal's "verify" step IS the create call, not a separate step before it).
  // The two guard clauses below used to `return toast.error(...)`
  // directly, which leaked toast.error's own return value (string | number,
  // a toast id) into handleSubmit's inferred return type — Promise<string |
  // number> instead of Promise<void>. identity-wallet-view.tsx's
  // handleVerify (the pattern this comment says it mirrors) never actually
  // hits this, since it has no pre-try guard clauses of its own; this
  // function does, so it needs its own explicit `return;` after each
  // toast.error call to keep the same Promise<void> shape OTPVerificationModal's
  // onVerify prop expects.
  const handleSubmit = async (orgEmailOtp?: string) => {
    if (!orgName.trim()) {
      toast.error("Organization name is required");
      return;
    }
    let memberCount: number | undefined;
    if (expectedMemberCount.trim()) {
      memberCount = Number(expectedMemberCount.trim());
      if (!Number.isInteger(memberCount) || memberCount < 1) {
        toast.error("Expected member count must be a positive whole number");
        return;
      }
    }
    // A superset of the backend's own member_count_risk_flag — that
    // flag also requires the account to be under a week old, which this
    // form has no way to know client-side (account age isn't part of the
    // session/user object). Asking for justification any time the count is
    // over the same threshold, account age aside, means we over-ask rather
    // than under-ask — a large, well-justified request just types one
    // sentence; the point is that a large *unexplained* one no longer
    // slips through with nothing for an admin to go on.
    if (
      memberCount !== undefined &&
      memberCount > MEMBER_COUNT_RISK_THRESHOLD &&
      !justification.trim()
    ) {
      toast.error(
        `A brief justification is needed for a request expecting more than ` +
          `${MEMBER_COUNT_RISK_THRESHOLD} members — it gives the reviewing admin ` +
          `something to go on.`,
      );
      return;
    }
    if (duplicateOpenRequest) {
      toast.error(
        `You already have an open request for "${duplicateOpenRequest.org_name}" ` +
          `(reference ${duplicateOpenRequest.reference_code}). Check My Requests ` +
          `instead of submitting it again.`,
      );
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.submitOrgRequest({
        org_name: orgName.trim(),
        org_email: orgEmail.trim() || undefined,
        org_email_otp: orgEmailOtp,
        expected_member_count: memberCount,
        justification: justification.trim() || undefined,
      });
      toast.success(result.message);
      onSuccess();
      handleClose();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to submit organization request");
    } finally {
      setSubmitting(false);
      setOtpOpen(false);
    }
  };

  // Step 1 (only reached when org_email is supplied): send the
  // domain-ownership OTP (backend) to org_email before the request can
  // be submitted with it attached.
  const handleSendOtp = async () => {
    if (!orgName.trim()) return toast.error("Organization name is required");
    if (!isEmailValid) return toast.error("Enter a valid organization email");
    // Same two checks handleSubmit() runs, moved up here too — this
    // path sends a verification email and only calls handleSubmit() once a
    // code comes back, so without this a duplicate-name or missing-
    // justification submission would waste an OTP round trip before
    // failing at the very last step.
    if (
      Number.isInteger(memberCountNum) &&
      memberCountNum > MEMBER_COUNT_RISK_THRESHOLD &&
      !justification.trim()
    ) {
      return toast.error(
        `A brief justification is needed for a request expecting more than ` +
          `${MEMBER_COUNT_RISK_THRESHOLD} members — it gives the reviewing admin ` +
          `something to go on.`,
      );
    }
    if (duplicateOpenRequest) {
      return toast.error(
        `You already have an open request for "${duplicateOpenRequest.org_name}" ` +
          `(reference ${duplicateOpenRequest.reference_code}). Check My Requests ` +
          `instead of submitting it again.`,
      );
    }

    const email = orgEmail.trim();

    // A code is already pending for this same email — reopen the OTP
    // dialog instead of requesting a new one. Without this, accidentally
    // clicking outside the OTP dialog (which closes it, and also re-opens
    // this form dialog via `open && !otpOpen`) and then clicking "Send
    // Verification Code" again immediately re-hits the backend's 30s resend
    // cooldown, which throws before the OTP dialog is ever reopened — the
    // button just shows a "please wait" error with no way back into it.
    if (otpContact === email) {
      setOtpOpen(true);
      return;
    }

    setSendingOtp(true);
    try {
      await api.sendOrgDomainOtp(email);
      setOtpContact(email);
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

  return (
    <>
      <Dialog
        open={open && !otpOpen}
        onOpenChange={(o) => {
          if (!o) handleClose();
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto">
          {step === "intro" ? (
            <>
              <DialogHeader>
                <DialogTitle>Request a New Organization</DialogTitle>
                <DialogDescription>
                  A site admin reviews every request — here's what makes that
                  review go smoothly.
                </DialogDescription>
              </DialogHeader>
              <ul className="mt-2 space-y-3 text-sm">
                <li className="flex gap-2.5">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <span className="font-medium">An organization name.</span>{" "}
                    The only required field.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <span className="font-medium">
                      Ideally, an org email you can verify.
                    </span>{" "}
                    Using your organization's own domain rather than a personal
                    one usually moves review along faster.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    <span className="font-medium">A short reason.</span> Why
                    this organization needs to exist — required for larger
                    expected member counts, optional otherwise.
                  </span>
                </li>
              </ul>
              <DialogFooter className="mt-6">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button onClick={() => setStep("form")}>Continue</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Request a New Organization</DialogTitle>
                <DialogDescription>
                  A site admin reviews every request. You'll be notified once
                  it's approved, rejected, or sent back for more information.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-5 mt-2">
                <div className="space-y-1.5">
                  <Label>
                    Organization Name{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    placeholder="e.g. Acme Corp"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    autoFocus
                  />
                  {/* Mirrors findOpenRequestByName() server-side — same
                      case-insensitive match against this requester's own
                      currently-open requests, shown as they type instead of
                      only as a 409 after they submit. */}
                  {duplicateOpenRequest && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                      You already have an open request for this name (reference{" "}
                      {duplicateOpenRequest.reference_code},{" "}
                      {duplicateOpenRequest.status === "PENDING"
                        ? "pending review"
                        : "needs info"}
                      ). Check <span className="font-medium">My Requests</span>{" "}
                      instead of submitting again.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>
                    Organization Email{" "}
                    <span className="text-muted-foreground font-normal">
                      (optional, strengthens your request)
                    </span>
                  </Label>
                  <Input
                    type="email"
                    placeholder="e.g. contact@acme.com"
                    value={orgEmail}
                    onChange={(e) => setOrgEmail(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    If provided, you'll verify a code sent here before the
                    request can be submitted.
                  </p>
                  {/* Mirrors isFreeEmailDomain() server-side — same
                      list, surfaced as a tip instead of only as a flag the
                      requester never sees. */}
                  {isEmailValid && isFreeEmailDomain(orgEmail.trim()) && (
                    <p className="text-xs text-amber-700">
                      Tip: a personal/free email address works, but your
                      organization's own domain usually speeds up review.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>
                    Expected Member Count{" "}
                    <span className="text-muted-foreground font-normal">
                      (optional)
                    </span>
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="e.g. 50"
                    value={expectedMemberCount}
                    onChange={(e) => setExpectedMemberCount(e.target.value)}
                    className="max-w-xs"
                  />
                  {/* Mirrors member_count_risk_flag's own threshold
                      (MEMBER_COUNT_RISK_THRESHOLD) — the backend only fires
                      that flag in combination with a new account, which this
                      form can't check, so this tip fires on count alone. */}
                  {memberCountAboveThreshold && (
                    <p className="text-xs text-amber-700">
                      Larger expected member counts get a closer look — add a
                      brief reason below so the reviewing admin has context.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>
                    Why does this organization need to exist?{" "}
                    <span
                      className={
                        memberCountAboveThreshold
                          ? "text-destructive font-normal"
                          : "text-muted-foreground font-normal"
                      }
                    >
                      {memberCountAboveThreshold
                        ? `(required for over ${MEMBER_COUNT_RISK_THRESHOLD} expected members)`
                        : "(optional)"}
                    </span>
                  </Label>
                  <Textarea
                    placeholder="A brief case for the reviewing admin…"
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    rows={4}
                    className="text-sm"
                  />
                </div>
              </div>
              <DialogFooter className="mt-6">
                <Button
                  variant="outline"
                  onClick={() => setStep("intro")}
                  disabled={submitting || sendingOtp}
                >
                  Back
                </Button>
                {orgEmail.trim() ? (
                  <Button
                    onClick={handleSendOtp}
                    disabled={
                      sendingOtp || submitting || !!duplicateOpenRequest
                    }
                  >
                    {sendingOtp && (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    )}
                    {sendingOtp ? "Sending code…" : "Send Verification Code"}
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleSubmit()}
                    disabled={submitting || !!duplicateOpenRequest}
                  >
                    {submitting && (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    )}
                    {submitting ? "Submitting…" : "Submit Request"}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <OTPVerificationModal
        open={otpOpen}
        onClose={() => setOtpOpen(false)}
        onVerify={handleSubmit}
        onResend={handleResendOtp}
        contact={orgEmail}
        sentAt={otpSentAt}
      />

      {/* Spinner overlay while the request submits after OTP verification */}
      {submitting && !otpOpen && (
        <Dialog open>
          <DialogContent className="sm:max-w-xs text-center py-8">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground mt-3">
              Submitting request…
            </p>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ─── Manage Assignments Dialog ────────────────────────────────────────────────
function ManageAssignmentsDialog({
  open,
  member,
  org,
  scopeTree,
  flatScopes,
  onClose,
  onSuccess,
}: {
  open: boolean;
  member: OrgMember | null;
  org: OrgSummary;
  scopeTree: ScopeNode[];
  flatScopes: ScopeNode[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [pendingEdits, setPendingEdits] = useState<
    Record<number, { is_voter?: boolean; is_organizer?: boolean }>
  >({});
  const [savingScopes, setSavingScopes] = useState<Set<number>>(new Set());

  const [movingScope, setMovingScope] = useState<number | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>("");
  const [moveVoter, setMoveVoter] = useState(false);
  const [moveOrganizer, setMoveOrganizer] = useState(false);
  const [moveLoading, setMoveLoading] = useState(false);

  const [removingScope, setRemovingScope] = useState<number | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addScopeId, setAddScopeId] = useState("");
  const [addVoter, setAddVoter] = useState(true);
  const [addOrganizer, setAddOrganizer] = useState(false);
  const [addLoading, setAddLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setPendingEdits({});
      setSavingScopes(new Set());
      setMovingScope(null);
      setMoveTarget("");
      setRemovingScope(null);
      setAddOpen(false);
      setAddScopeId("");
      setAddVoter(true);
      setAddOrganizer(false);
    }
  }, [open, member?.uid]);

  if (!member) return null;

  const assignedScopeIds = member.roles.map((r) => r.scope_id);

  const getEdited = (r: MemberRole) => ({
    is_voter: pendingEdits[r.scope_id]?.is_voter ?? r.is_voter,
    is_organizer: pendingEdits[r.scope_id]?.is_organizer ?? r.is_organizer,
  });

  const isDirty = (r: MemberRole) => {
    const e = pendingEdits[r.scope_id];
    if (!e) return false;
    return (
      (e.is_voter !== undefined && e.is_voter !== r.is_voter) ||
      (e.is_organizer !== undefined && e.is_organizer !== r.is_organizer)
    );
  };

  const handleSaveRow = async (r: MemberRole) => {
    if (!isDirty(r)) return;
    setSavingScopes((s) => new Set(s).add(r.scope_id));
    try {
      await api.updateMember(org.orgid, org.uid, member.uid, {
        scope_id: r.scope_id,
        ...pendingEdits[r.scope_id],
      });
      toast.success(
        `Updated ${member.uid} at ${flatScopes.find((s) => s.scope_id === r.scope_id)?.scope_name}`,
      );
      setPendingEdits((p) => {
        const n = { ...p };
        delete n[r.scope_id];
        return n;
      });
      onSuccess();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to update");
    } finally {
      setSavingScopes((s) => {
        const n = new Set(s);
        n.delete(r.scope_id);
        return n;
      });
    }
  };

  const startMove = (r: MemberRole) => {
    setMovingScope(r.scope_id);
    setMoveTarget("");
    setMoveVoter(r.is_voter);
    setMoveOrganizer(r.is_organizer);
  };

  const cancelMove = () => {
    setMovingScope(null);
    setMoveTarget("");
  };

  const handleMove = async (fromScopeId: number) => {
    if (!moveTarget) return toast.error("Select a target scope");
    setMoveLoading(true);
    try {
      await api.moveMemberRole(org.orgid, org.uid, member.uid, {
        from_scope_id: fromScopeId,
        to_scope_id: Number(moveTarget),
        is_voter: moveVoter,
        is_organizer: moveOrganizer,
      });
      const fromName = flatScopes.find(
        (s) => s.scope_id === fromScopeId,
      )?.scope_name;
      const toName = flatScopes.find(
        (s) => s.scope_id === Number(moveTarget),
      )?.scope_name;
      toast.success(`Moved ${member.uid} from "${fromName}" → "${toName}"`);
      setMovingScope(null);
      setMoveTarget("");
      onSuccess();
    } catch (e: any) {
      toast.error(e.message ?? "Move failed");
    } finally {
      setMoveLoading(false);
    }
  };

  const handleRemoveRole = async () => {
    if (removingScope === null) return;
    setRemoveLoading(true);
    try {
      await api.removeMemberRole(org.orgid, org.uid, member.uid, removingScope);
      const scopeName = flatScopes.find(
        (s) => s.scope_id === removingScope,
      )?.scope_name;
      toast.success(`Removed ${member.uid} from "${scopeName}"`);
      setRemovingScope(null);
      onSuccess();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to remove assignment");
    } finally {
      setRemoveLoading(false);
    }
  };

  const handleAddRole = async () => {
    if (!addScopeId) return toast.error("Select a scope");
    setAddLoading(true);
    try {
      await api.addMemberRole(org.orgid, org.uid, member.uid, {
        scope_id: Number(addScopeId),
        is_voter: addVoter,
        is_organizer: addOrganizer,
      });
      const scopeName = flatScopes.find(
        (s) => s.scope_id === Number(addScopeId),
      )?.scope_name;
      toast.success(`${member.uid} assigned to "${scopeName}"`);
      setAddOpen(false);
      setAddScopeId("");
      setAddVoter(true);
      setAddOrganizer(false);
      onSuccess();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to add assignment");
    } finally {
      setAddLoading(false);
    }
  };

  const hasPendingChanges = Object.keys(pendingEdits).length > 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-2xl max-h-[90dvh] flex flex-col gap-0 p-0">
          <div className="px-6 pt-5 pb-4 border-b">
            <DialogTitle className="text-base font-semibold">
              Manage Assignments
            </DialogTitle>
            <DialogDescription className="mt-0.5">
              <span className="font-mono font-medium text-foreground">
                {member.uid}
              </span>
              <span className="text-muted-foreground">
                {" "}
                · {member.email ?? member.mobile ?? "No contact"}
              </span>
            </DialogDescription>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0">
            {member.roles.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground border rounded-md">
                No scope assignments. Add one below.
              </div>
            ) : (
              <div className="border rounded-md overflow-hidden max-md:border-0 max-md:rounded-none max-md:overflow-visible">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Scope</TableHead>
                      <TableHead className="w-20 text-center">Voter</TableHead>
                      <TableHead className="w-24 text-center">
                        Organizer
                      </TableHead>
                      <TableHead className="w-32 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {member.roles.map((r) => {
                      const scopeName =
                        flatScopes.find((s) => s.scope_id === r.scope_id)
                          ?.scope_name ?? `Scope ${r.scope_id}`;
                      const edited = getEdited(r);
                      const dirty = isDirty(r);
                      const saving = savingScopes.has(r.scope_id);
                      const isMoving = movingScope === r.scope_id;

                      // Fragments in a .map() must have an explicit key.
                      // Using React.Fragment instead of <> so the key prop can be set.
                      return (
                        <React.Fragment key={r.scope_id}>
                          <TableRow
                            className={
                              dirty ? "bg-amber-50 dark:bg-amber-950/20" : ""
                            }
                          >
                            <TableCell className="font-medium text-sm">
                              {scopeName}
                            </TableCell>

                            <TableCell className="text-center">
                              <Checkbox
                                checked={edited.is_voter}
                                onCheckedChange={(v) =>
                                  setPendingEdits((p) => ({
                                    ...p,
                                    [r.scope_id]: {
                                      ...p[r.scope_id],
                                      is_voter: Boolean(v),
                                    },
                                  }))
                                }
                              />
                            </TableCell>

                            <TableCell className="text-center">
                              <Checkbox
                                checked={edited.is_organizer}
                                onCheckedChange={(v) =>
                                  setPendingEdits((p) => ({
                                    ...p,
                                    [r.scope_id]: {
                                      ...p[r.scope_id],
                                      is_organizer: Boolean(v),
                                    },
                                  }))
                                }
                              />
                            </TableCell>

                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                {dirty ? (
                                  <>
                                    <Button
                                      size="sm"
                                      className="h-7 px-2 text-xs"
                                      onClick={() => handleSaveRow(r)}
                                      disabled={saving}
                                    >
                                      {saving ? "…" : "Save"}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-xs text-muted-foreground"
                                      onClick={() =>
                                        setPendingEdits((p) => {
                                          const n = { ...p };
                                          delete n[r.scope_id];
                                          return n;
                                        })
                                      }
                                    >
                                      Undo
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-xs"
                                      onClick={() =>
                                        isMoving ? cancelMove() : startMove(r)
                                      }
                                    >
                                      {isMoving ? "Cancel" : "Move"}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                      onClick={() =>
                                        setRemovingScope(r.scope_id)
                                      }
                                    >
                                      ✕
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>

                          {isMoving && (
                            <TableRow className="bg-muted/30">
                              <TableCell colSpan={4} className="py-3 px-4">
                                <div className="flex items-end gap-3 flex-wrap">
                                  <div className="space-y-1 flex-1 min-w-44">
                                    <p className="text-xs text-muted-foreground font-medium">
                                      Move to scope
                                    </p>
                                    <ScopeTreeSelect
                                      scopeTree={scopeTree}
                                      flatScopes={flatScopes}
                                      value={moveTarget}
                                      onChange={setMoveTarget}
                                      exclude={assignedScopeIds}
                                      placeholder="Pick target scope…"
                                      className="w-full"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-xs text-muted-foreground font-medium">
                                      Roles at new scope
                                    </p>
                                    <div className="flex items-center gap-3">
                                      <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                                        <Checkbox
                                          checked={moveVoter}
                                          onCheckedChange={(v) =>
                                            setMoveVoter(Boolean(v))
                                          }
                                        />
                                        Voter
                                      </label>
                                      <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                                        <Checkbox
                                          checked={moveOrganizer}
                                          onCheckedChange={(v) =>
                                            setMoveOrganizer(Boolean(v))
                                          }
                                        />
                                        Organizer
                                      </label>
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    onClick={() => handleMove(r.scope_id)}
                                    disabled={!moveTarget || moveLoading}
                                    className="h-8"
                                  >
                                    {moveLoading ? "Moving…" : "Confirm Move"}
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {addOpen ? (
              <div className="border rounded-md px-4 py-3 space-y-3 bg-muted/20">
                <p className="text-sm font-semibold">New scope assignment</p>
                <div className="flex items-end gap-3 flex-wrap">
                  <div className="space-y-1 flex-1 min-w-44">
                    <p className="text-xs text-muted-foreground">
                      Scope <span className="text-destructive">*</span>
                    </p>
                    <ScopeTreeSelect
                      scopeTree={scopeTree}
                      flatScopes={flatScopes}
                      value={addScopeId}
                      onChange={setAddScopeId}
                      exclude={assignedScopeIds}
                      placeholder="Select scope…"
                      className="w-full"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Roles</p>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                        <Checkbox
                          checked={addVoter}
                          onCheckedChange={(v) => setAddVoter(Boolean(v))}
                        />
                        Voter
                      </label>
                      <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                        <Checkbox
                          checked={addOrganizer}
                          onCheckedChange={(v) => setAddOrganizer(Boolean(v))}
                        />
                        Organizer
                      </label>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleAddRole}
                      disabled={!addScopeId || addLoading}
                      className="h-8"
                    >
                      {addLoading ? "Adding…" : "Add"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAddOpen(false);
                        setAddScopeId("");
                      }}
                      className="h-8"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAddOpen(true)}
                disabled={assignedScopeIds.length >= flatScopes.length}
              >
                + Add scope assignment
              </Button>
            )}

            {hasPendingChanges && (
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <TriangleAlert className="w-3.5 h-3.5 flex-shrink-0" />
                You have unsaved role changes — click Save on each row to apply
                them.
              </p>
            )}
          </div>

          <div className="px-6 py-4 border-t flex justify-between items-center">
            <p className="text-xs text-muted-foreground">
              {member.roles.length} scope assignment
              {member.roles.length !== 1 ? "s" : ""}
            </p>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={removingScope !== null}
        onOpenChange={(o) => !o && setRemovingScope(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove assignment?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono font-medium">{member.uid}</span> will
              lose their role at{" "}
              <span className="font-semibold">
                {flatScopes.find((s) => s.scope_id === removingScope)
                  ?.scope_name ?? `Scope ${removingScope}`}
              </span>
              .
              {member.roles.length === 1 && (
                <span className="block mt-2 text-destructive font-medium">
                  This is their only assignment. The member will be fully
                  deactivated.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeLoading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveRole}
              disabled={removeLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeLoading ? "Removing…" : "Remove Assignment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Quick Move (one click for single-scope members) ──────────────────────────
function QuickMoveButton({
  member,
  org,
  scopeTree,
  flatScopes,
  onManageInstead,
  onSuccess,
}: {
  member: OrgMember;
  org: OrgSummary;
  scopeTree: ScopeNode[];
  flatScopes: ScopeNode[];
  onManageInstead: () => void;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [voter, setVoter] = useState(false);
  const [organizer, setOrganizer] = useState(false);
  const [loading, setLoading] = useState(false);

  if (member.roles.length === 0) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-muted-foreground/40 cursor-not-allowed"
        disabled
        title="No assignment to move"
      >
        <ArrowLeftRight className="w-3.5 h-3.5" />
      </Button>
    );
  }

  // Multiple assignments: ambiguous which one to move from a single click — hand off to the full dialog.
  if (member.roles.length > 1) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation();
          onManageInstead();
        }}
        title="Move — has multiple assignments, opens Manage"
      >
        <ArrowLeftRight className="w-3.5 h-3.5" />
      </Button>
    );
  }

  const role = member.roles[0];
  const currentScopeName =
    flatScopes.find((s) => s.scope_id === role.scope_id)?.scope_name ??
    `Scope ${role.scope_id}`;

  const handleOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) {
      setTarget("");
      setVoter(role.is_voter);
      setOrganizer(role.is_organizer);
    }
  };

  const handleMove = async () => {
    if (!target) return toast.error("Select a target scope");
    setLoading(true);
    try {
      await api.moveMemberRole(org.orgid, org.uid, member.uid, {
        from_scope_id: role.scope_id,
        to_scope_id: Number(target),
        is_voter: voter,
        is_organizer: organizer,
      });
      const toName = flatScopes.find(
        (s) => s.scope_id === Number(target),
      )?.scope_name;
      toast.success(
        `Moved ${member.uid} from "${currentScopeName}" → "${toName}"`,
      );
      setOpen(false);
      onSuccess();
    } catch (e: any) {
      toast.error(e.message ?? "Move failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
          title="Move to another scope"
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-3"
        align="end"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-semibold mb-1">Move {member.uid}</p>
        <p className="text-xs text-muted-foreground mb-3">
          From{" "}
          <span className="font-medium text-foreground">
            {currentScopeName}
          </span>
        </p>
        <div className="space-y-2.5">
          <ScopeTreeSelect
            scopeTree={scopeTree}
            flatScopes={flatScopes}
            value={target}
            onChange={setTarget}
            exclude={[role.scope_id]}
            placeholder="Move to…"
            className="w-full h-8 text-sm"
          />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <Checkbox
                checked={voter}
                onCheckedChange={(v) => setVoter(Boolean(v))}
              />{" "}
              Voter
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <Checkbox
                checked={organizer}
                onCheckedChange={(v) => setOrganizer(Boolean(v))}
              />{" "}
              Organizer
            </label>
          </div>
          <Button
            size="sm"
            className="w-full h-8"
            onClick={handleMove}
            disabled={!target || loading}
          >
            {loading ? "Moving…" : "Confirm Move"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Bulk Edit Dialog ─────────────────────────────────────────────────────────
function BulkEditDialog({
  open,
  selectedUids,
  members,
  org,
  scopeTree,
  flatScopes,
  initialTab = "update",
  onClose,
  onSuccess,
}: {
  open: boolean;
  selectedUids: string[];
  members: OrgMember[];
  org: OrgSummary;
  scopeTree: ScopeNode[];
  flatScopes: ScopeNode[];
  initialTab?: "update" | "move" | "add";
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [tab, setTab] = useState<"update" | "move" | "add">(initialTab);

  const [voterChange, setVoterChange] = useState<"yes" | "no" | "keep">("keep");
  const [organizerChange, setOrganizerChange] = useState<"yes" | "no" | "keep">(
    "keep",
  );
  const [targetScopeId, setTargetScopeId] = useState<string>("");

  const [moveFromScopeId, setMoveFromScopeId] = useState<string>("");
  const [moveToScopeId, setMoveToScopeId] = useState<string>("");
  const [moveKeepRoles, setMoveKeepRoles] = useState(true);
  const [moveVoter, setMoveVoter] = useState(true);
  const [moveOrganizer, setMoveOrganizer] = useState(false);

  const [addScopeId, setAddScopeId] = useState("");
  const [addVoter, setAddVoter] = useState(true);
  const [addOrganizer, setAddOrganizer] = useState(false);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setVoterChange("keep");
      setOrganizerChange("keep");
      setTargetScopeId("");
      setMoveFromScopeId("");
      setMoveToScopeId("");
      setMoveKeepRoles(true);
      setMoveVoter(true);
      setMoveOrganizer(false);
      setAddScopeId("");
      setAddVoter(true);
      setAddOrganizer(false);
      setProgress(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const hasUpdateChanges = voterChange !== "keep" || organizerChange !== "keep";

  // Members among the current selection that actually hold a role at the "move from" scope.
  const eligibleForMove = moveFromScopeId
    ? members.filter(
        (m) =>
          selectedUids.includes(m.uid) &&
          m.roles.some((r) => String(r.scope_id) === moveFromScopeId),
      )
    : [];

  const handleApplyUpdate = async () => {
    if (!hasUpdateChanges) return toast.error("No role changes selected");
    if (!targetScopeId)
      return toast.error("Select the scope assignment to update");
    setLoading(true);
    setProgress(0);
    let successCount = 0;
    const errors: string[] = [];
    for (let i = 0; i < selectedUids.length; i++) {
      try {
        const payload: Parameters<typeof api.updateMember>[3] = {
          scope_id: Number(targetScopeId),
        };
        if (voterChange !== "keep") payload.is_voter = voterChange === "yes";
        if (organizerChange !== "keep")
          payload.is_organizer = organizerChange === "yes";
        await api.updateMember(org.orgid, org.uid, selectedUids[i], payload);
        successCount++;
      } catch (e: any) {
        errors.push(`${selectedUids[i]}: ${e.message ?? "error"}`);
      }
      setProgress(Math.round(((i + 1) / selectedUids.length) * 100));
    }
    if (successCount > 0)
      toast.success(
        `Updated ${successCount} member${successCount !== 1 ? "s" : ""}`,
      );
    errors.forEach((e) => toast.error(e));
    setLoading(false);
    onSuccess();
    onClose();
  };

  const handleApplyAdd = async () => {
    if (!addScopeId) return toast.error("Select a scope");
    setLoading(true);
    setProgress(0);
    let successCount = 0;
    const errors: string[] = [];
    for (let i = 0; i < selectedUids.length; i++) {
      try {
        await api.addMemberRole(org.orgid, org.uid, selectedUids[i], {
          scope_id: Number(addScopeId),
          is_voter: addVoter,
          is_organizer: addOrganizer,
        });
        successCount++;
      } catch (e: any) {
        errors.push(`${selectedUids[i]}: ${e.message ?? "error"}`);
      }
      setProgress(Math.round(((i + 1) / selectedUids.length) * 100));
    }
    const scopeName = flatScopes.find(
      (s) => String(s.scope_id) === addScopeId,
    )?.scope_name;
    if (successCount > 0)
      toast.success(
        `Added "${scopeName}" assignment to ${successCount} member${successCount !== 1 ? "s" : ""}`,
      );
    errors.forEach((e) => toast.error(e));
    setLoading(false);
    onSuccess();
    onClose();
  };

  const handleApplyMove = async () => {
    if (!moveFromScopeId)
      return toast.error("Select the scope members are moving from");
    if (!moveToScopeId) return toast.error("Select the target scope");
    if (eligibleForMove.length === 0)
      return toast.error("None of the selected members hold that scope");
    setLoading(true);
    setProgress(0);
    let successCount = 0;
    const errors: string[] = [];
    for (let i = 0; i < eligibleForMove.length; i++) {
      const m = eligibleForMove[i];
      const role = m.roles.find((r) => String(r.scope_id) === moveFromScopeId)!;
      try {
        await api.moveMemberRole(org.orgid, org.uid, m.uid, {
          from_scope_id: role.scope_id,
          to_scope_id: Number(moveToScopeId),
          is_voter: moveKeepRoles ? role.is_voter : moveVoter,
          is_organizer: moveKeepRoles ? role.is_organizer : moveOrganizer,
        });
        successCount++;
      } catch (e: any) {
        errors.push(`${m.uid}: ${e.message ?? "error"}`);
      }
      setProgress(Math.round(((i + 1) / eligibleForMove.length) * 100));
    }
    const fromName = flatScopes.find(
      (s) => String(s.scope_id) === moveFromScopeId,
    )?.scope_name;
    const toName = flatScopes.find(
      (s) => String(s.scope_id) === moveToScopeId,
    )?.scope_name;
    if (successCount > 0)
      toast.success(
        `Moved ${successCount} member${successCount !== 1 ? "s" : ""} from "${fromName}" → "${toName}"`,
      );
    errors.forEach((e) => toast.error(e));
    setLoading(false);
    onSuccess();
    onClose();
  };

  const TriToggle = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: "keep" | "yes" | "no";
    onChange: (v: "keep" | "yes" | "no") => void;
  }) => (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="flex gap-2">
        {(["keep", "yes", "no"] as const).map((v) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`flex-1 py-1.5 px-3 rounded-md border text-sm font-medium transition-colors
                    ${
                      value === v
                        ? v === "no"
                          ? "bg-destructive/10 border-destructive/40 text-destructive"
                          : v === "yes"
                            ? "bg-primary/10 border-primary/40 text-primary"
                            : "bg-accent border-border text-foreground"
                        : "border-border text-muted-foreground hover:bg-accent/50"
                    }`}
          >
            {v === "keep" ? "Keep" : v === "yes" ? "✓ Enable" : "✕ Disable"}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Edit Members</DialogTitle>
          <DialogDescription>
            Applying to{" "}
            <span className="font-semibold text-foreground">
              {selectedUids.length}
            </span>{" "}
            selected member{selectedUids.length !== 1 ? "s" : ""}.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="w-full">
            <TabsTrigger value="update" className="flex-1">
              Update roles
            </TabsTrigger>
            <TabsTrigger value="move" className="flex-1">
              Move scope
            </TabsTrigger>
            <TabsTrigger value="add" className="flex-1">
              Add assignment
            </TabsTrigger>
          </TabsList>

          <TabsContent value="update" className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">
              Changes apply to the selected members' role at a specific scope.
              Members who don't have that scope are skipped.
            </p>
            <div className="space-y-1.5">
              <Label>
                Scope to update <span className="text-destructive">*</span>
              </Label>
              <ScopeTreeSelect
                scopeTree={scopeTree}
                flatScopes={flatScopes}
                value={targetScopeId}
                onChange={setTargetScopeId}
                placeholder="Pick scope…"
                className="w-full"
              />
            </div>
            <TriToggle
              label="Voter Role"
              value={voterChange}
              onChange={setVoterChange}
            />
            <TriToggle
              label="Organizer Role"
              value={organizerChange}
              onChange={setOrganizerChange}
            />
          </TabsContent>

          <TabsContent value="move" className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">
              Moves each selected member's assignment from one scope to another
              in a single step. Members who don't hold the "from" scope are
              skipped automatically.
            </p>
            <div className="grid grid-cols-2 gap-3 items-end">
              <div className="space-y-1.5">
                <Label>
                  From scope <span className="text-destructive">*</span>
                </Label>
                <ScopeTreeSelect
                  scopeTree={scopeTree}
                  flatScopes={flatScopes}
                  value={moveFromScopeId}
                  onChange={setMoveFromScopeId}
                  placeholder="Current scope…"
                  className="w-full"
                />
              </div>
              <div className="flex items-center justify-center pb-2">
                <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>
                To scope <span className="text-destructive">*</span>
              </Label>
              <ScopeTreeSelect
                scopeTree={scopeTree}
                flatScopes={flatScopes}
                value={moveToScopeId}
                onChange={setMoveToScopeId}
                exclude={moveFromScopeId ? [Number(moveFromScopeId)] : []}
                placeholder="Target scope…"
                className="w-full"
              />
            </div>

            {moveFromScopeId && (
              <p className="text-xs">
                <span className="font-semibold text-foreground">
                  {eligibleForMove.length}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  of {selectedUids.length} selected member
                  {selectedUids.length !== 1 ? "s" : ""} hold this scope and
                  will be moved.
                </span>
              </p>
            )}

            <Separator />

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox
                  checked={moveKeepRoles}
                  onCheckedChange={(v) => setMoveKeepRoles(Boolean(v))}
                />
                Keep each member's existing Voter/Organizer roles
              </label>
              {!moveKeepRoles && (
                <div className="flex items-center gap-4 pl-6">
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <Checkbox
                      checked={moveVoter}
                      onCheckedChange={(v) => setMoveVoter(Boolean(v))}
                    />
                    Voter
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                    <Checkbox
                      checked={moveOrganizer}
                      onCheckedChange={(v) => setMoveOrganizer(Boolean(v))}
                    />
                    Organizer
                  </label>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="add" className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">
              Adds a new scope assignment to all selected members. Members who
              already have this scope will have their roles updated.
            </p>
            <div className="space-y-1.5">
              <Label>
                Scope <span className="text-destructive">*</span>
              </Label>
              <ScopeTreeSelect
                scopeTree={scopeTree}
                flatScopes={flatScopes}
                value={addScopeId}
                onChange={setAddScopeId}
                placeholder="Select scope…"
                className="w-full"
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox
                  checked={addVoter}
                  onCheckedChange={(v) => setAddVoter(Boolean(v))}
                />
                Voter
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox
                  checked={addOrganizer}
                  onCheckedChange={(v) => setAddOrganizer(Boolean(v))}
                />
                Organizer
              </label>
            </div>
          </TabsContent>
        </Tabs>

        {loading && (
          <div className="space-y-1.5 mt-2">
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground text-center">
              {progress}%
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={
              tab === "update"
                ? handleApplyUpdate
                : tab === "move"
                  ? handleApplyMove
                  : handleApplyAdd
            }
            disabled={
              loading ||
              (tab === "update"
                ? !hasUpdateChanges || !targetScopeId
                : tab === "move"
                  ? !moveFromScopeId ||
                    !moveToScopeId ||
                    eligibleForMove.length === 0
                  : !addScopeId)
            }
          >
            {loading
              ? "Applying…"
              : tab === "move"
                ? `Move ${eligibleForMove.length || ""}`.trim()
                : `Apply to ${selectedUids.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk Action Bar ──────────────────────────────────────────────────────────
function BulkActionBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClearSelection,
  onBulkEdit,
  onBulkMove,
  onBulkRemove,
}: {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkEdit: () => void;
  onBulkMove: () => void;
  onBulkRemove: () => void;
}) {
  const allSelected = selectedCount === totalCount && totalCount > 0;
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 md:flex md:flex-wrap md:items-center md:gap-3 md:rounded-lg md:px-3 md:py-2">
      {/* Row 1 (phones): count + select-all on the left, clear on the right */}
      <div className="flex items-center gap-3 md:contents">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-sm font-semibold text-primary tabular-nums">
            {selectedCount}
          </span>
          <span className="text-sm text-muted-foreground">
            of {totalCount} selected
          </span>
        </div>
        <Separator orientation="vertical" className="h-4" />
        <button
          className="text-xs text-primary hover:underline font-medium whitespace-nowrap py-1"
          onClick={allSelected ? onClearSelection : onSelectAll}
        >
          {allSelected ? "Clear all" : `Select all ${totalCount}`}
        </button>
        <button
          className="ml-auto -mr-1 grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-foreground md:hidden"
          onClick={onClearSelection}
          title="Clear selection"
          aria-label="Clear selection"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {/* Row 2 (phones): three equal, full-width actions */}
      <div className="mt-3 grid grid-cols-3 gap-2 md:mt-0 md:ml-auto md:flex md:items-center">
        <Button
          size="sm"
          variant="outline"
          className="h-10 gap-1.5 bg-card px-2 text-xs md:h-7"
          onClick={onBulkMove}
        >
          <ArrowLeftRight className="w-3.5 h-3.5" /> Move
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-10 gap-1.5 bg-card px-2 text-xs md:h-7"
          onClick={onBulkEdit}
        >
          <Pencil className="w-3.5 h-3.5" /> Edit roles
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-10 gap-1.5 bg-card px-2 text-xs text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive md:h-7"
          onClick={onBulkRemove}
        >
          <Trash2 className="w-3.5 h-3.5" /> Remove
        </Button>
        <button
          className="ml-1 hidden text-muted-foreground hover:text-foreground md:block"
          onClick={onClearSelection}
          title="Clear selection"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Scope Actions Panel ──────────────────────────────────────────────────────
function ScopeActionsPanel({
  node,
  org,
  flatScopes,
  members,
  onRefresh,
  onViewMembers,
}: {
  node: ScopeNode;
  org: OrgSummary;
  flatScopes: ScopeNode[];
  members: OrgMember[];
  onRefresh: () => void;
  onViewMembers: (scopeId: number) => void;
}) {
  const isRoot = node.parent_scope_id === null;
  const hasChildren = node.children && node.children.length > 0;
  const membersHere = members.filter((m) =>
    m.roles.some((r) => r.scope_id === node.scope_id),
  );

  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(node.scope_name);
  const [renameLoading, setRenameLoading] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [childName, setChildName] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    setNewName(node.scope_name);
    setRenaming(false);
    setAddingChild(false);
    setChildName("");
  }, [node.scope_id]);

  const handleRename = async () => {
    if (!newName.trim() || newName.trim() === node.scope_name) {
      setRenaming(false);
      return;
    }
    setRenameLoading(true);
    try {
      await api.updateScope(org.orgid, org.uid, node.scope_id, {
        scope_name: newName.trim(),
      });
      toast.success("Scope renamed");
      onRefresh();
      setRenaming(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to rename scope");
    } finally {
      setRenameLoading(false);
    }
  };

  const handleAddChild = async () => {
    if (!childName.trim()) return;
    setAddLoading(true);
    try {
      await api.createScope(org.orgid, org.uid, {
        scope_name: childName.trim(),
        parent_scope_id: node.scope_id,
      });
      toast.success(`Scope "${childName.trim()}" created`);
      onRefresh();
      setAddingChild(false);
      setChildName("");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to create scope");
    } finally {
      setAddLoading(false);
    }
  };

  const handleDelete = async () => {
    setDeleteLoading(true);
    try {
      await api.deleteScope(org.orgid, org.uid, node.scope_id);
      toast.success("Scope deleted");
      onRefresh();
      setDeleteOpen(false);
    } catch (e: any) {
      toast.error(
        e?.cause?.originalMessage ?? e?.message ?? "Failed to delete scope",
      );
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-base font-semibold">{node.scope_name}</p>
          {isRoot && (
            <Badge variant="secondary" className="text-xs">
              ROOT
            </Badge>
          )}
        </div>
        <p className="text-xs font-mono text-muted-foreground">
          {node.parent_scope_id != null && (
            <>
              Parent:{" "}
              <span className="font-medium text-foreground">
                {flatScopes.find((s) => s.scope_id === node.parent_scope_id)
                  ?.scope_name ?? "—"}
              </span>
            </>
          )}
        </p>
      </div>

      <button
        onClick={() => onViewMembers(node.scope_id)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-md border bg-muted/20 hover:bg-accent transition-colors text-left"
      >
        <span className="flex items-center gap-1.5 text-sm">
          <Users className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-semibold tabular-nums">
            {membersHere.length}
          </span>
          <span className="text-muted-foreground">
            member{membersHere.length !== 1 ? "s" : ""} assigned here
          </span>
        </span>
        <span className="text-xs text-primary font-medium whitespace-nowrap">
          View & manage →
        </span>
      </button>

      <Separator />
      {!isRoot && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Rename
          </p>
          {renaming ? (
            <div className="flex gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-8 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") {
                    setRenaming(false);
                    setNewName(node.scope_name);
                  }
                }}
              />
              <Button
                size="sm"
                className="h-8"
                onClick={handleRename}
                disabled={renameLoading}
              >
                {renameLoading ? "…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => {
                  setRenaming(false);
                  setNewName(node.scope_name);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRenaming(true)}
            >
              Rename scope
            </Button>
          )}
        </div>
      )}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Add Child Scope
        </p>
        {addingChild ? (
          <div className="flex gap-2">
            <Input
              placeholder="Scope name"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              className="h-8 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddChild();
                if (e.key === "Escape") {
                  setAddingChild(false);
                  setChildName("");
                }
              }}
            />
            <Button
              size="sm"
              className="h-8"
              onClick={handleAddChild}
              disabled={addLoading}
            >
              {addLoading ? "…" : "Create"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => {
                setAddingChild(false);
                setChildName("");
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddingChild(true)}
          >
            + Add child scope
          </Button>
        )}
      </div>
      {!isRoot && !hasChildren && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Danger Zone
          </p>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/5"
            onClick={() => setDeleteOpen(true)}
          >
            Delete this scope
          </Button>
          <p className="text-xs text-muted-foreground">
            Only leaf nodes with no members or active events can be deleted.
          </p>
        </div>
      )}
      {hasChildren && !isRoot && (
        <p className="text-xs text-muted-foreground italic">
          Remove all child scopes before deleting this node.
        </p>
      )}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{node.scope_name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This scope will be permanently removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading ? "Deleting…" : "Delete Scope"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Add Members Dialog ───────────────────────────────────────────────────────
type AddMemberRow = {
  id: string;
  uid: string;
  contact: string;
  role: "v" | "o" | "vo" | "none";
  scopeId: string;
};

function makeRow(
  uid = "",
  contact = "",
  role: "v" | "o" | "vo" | "none" = "v",
  scopeId = "",
): AddMemberRow {
  return {
    id: Math.random().toString(36).slice(2, 9),
    uid,
    contact,
    role,
    scopeId,
  };
}

function RowScopePicker({
  rowId,
  scopeId,
  defaultScopeId,
  scopeTree,
  flatScopes,
  onChange,
}: {
  rowId: string;
  scopeId: string;
  defaultScopeId: string;
  scopeTree: ScopeNode[];
  flatScopes: ScopeNode[];
  onChange: (id: string, val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasOverride = !!scopeId;
  const label = hasOverride
    ? (flatScopes.find((s) => String(s.scope_id) === scopeId)?.scope_name ??
      "Unknown")
    : defaultScopeId
      ? (flatScopes.find((s) => String(s.scope_id) === defaultScopeId)
          ?.scope_name ?? "Default")
      : "Org root";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`group flex items-center gap-1.5 text-xs rounded-md border px-2 py-1.5 transition-colors
            hover:bg-accent max-w-[180px] w-full text-left
            ${hasOverride ? "border-primary/40 text-primary bg-primary/5 font-medium" : "border-border text-muted-foreground"}`}
        >
          {hasOverride && (
            <span
              className="flex-shrink-0 hover:text-destructive transition-colors leading-none"
              onClick={(e) => {
                e.stopPropagation();
                onChange(rowId, "");
                setOpen(false);
              }}
              title="Clear override"
            >
              ✕
            </span>
          )}
          <span className="truncate flex-1">{label}</span>
          {!hasOverride && (
            <span className="flex-shrink-0 opacity-40 text-[10px]">▾</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-1 w-56" align="start" sideOffset={4}>
        <div className="max-h-60 overflow-y-auto">
          <div
            className={`py-1.5 px-2.5 rounded-md cursor-pointer text-sm transition-colors
              ${!scopeId ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
            onClick={() => {
              onChange(rowId, "");
              setOpen(false);
            }}
          >
            <span className="font-medium">Use default scope</span>
            {defaultScopeId && (
              <span className="ml-1.5 text-[11px] opacity-70">
                (
                {flatScopes.find((s) => String(s.scope_id) === defaultScopeId)
                  ?.scope_name ?? "…"}
                )
              </span>
            )}
          </div>
          <div className="my-1 border-t" />
          {scopeTree.map((node) => (
            <ScopeTreeSelectNode
              key={node.scope_id}
              node={node}
              depth={0}
              value={scopeId}
              onSelect={(v) => {
                onChange(rowId, v);
                setOpen(false);
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AddMembersDialog({
  open,
  org,
  scopeTree,
  flatScopes,
  onClose,
  onSuccess,
}: {
  open: boolean;
  org: OrgSummary;
  scopeTree: ScopeNode[];
  flatScopes: ScopeNode[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<"input" | "review">("input");
  const [inputTab, setInputTab] = useState<"table" | "csv">("table");
  const [csvText, setCsvText] = useState("");
  const [csvError, setCsvError] = useState("");
  const [rows, setRows] = useState<AddMemberRow[]>([makeRow()]);
  const [defaultScopeId, setDefaultScopeId] = useState<string>("");
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewRoleFilter, setReviewRoleFilter] = useState<
    "all" | "v" | "o" | "vo" | "none"
  >("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkScopeId, setBulkScopeId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setStep("input");
      setInputTab("table");
      setCsvText("");
      setCsvError("");
      setRows([makeRow()]);
      setDefaultScopeId("");
      setReviewSearch("");
      setReviewRoleFilter("all");
      setSelectedIds(new Set());
      setBulkScopeId("");
    }
  }, [open]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [reviewSearch, reviewRoleFilter]);

  const updateRow = (
    id: string,
    field: keyof Omit<AddMemberRow, "id">,
    val: string,
  ) =>
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: val } : r)),
    );

  const removeRow = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSelectedIds((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  };

  const parseCsvToReview = () => {
    const parsed = parseCsv(csvText);
    if (!parsed.length) {
      setCsvError("No valid rows found. Check header: uid,contact,role");
      return;
    }
    const newRows = parsed
      .filter((r) => (r.uid ?? "").trim())
      .map((r) =>
        makeRow(
          (r.uid ?? "").trim().toUpperCase(),
          (r.contact ?? r.email ?? r.mobile ?? "").trim(),
          ["v", "o", "vo", "none"].includes((r.role ?? "").trim())
            ? (r.role.trim() as "v" | "o" | "vo" | "none")
            : "v",
        ),
      );
    if (!newRows.length) {
      setCsvError("No rows with a UID found");
      return;
    }
    setCsvError("");
    setRows(newRows);
    setStep("review");
  };

  const goToReview = () => {
    const valid = rows.filter((r) => r.uid.trim());
    if (!valid.length) {
      toast.error("Add at least one member with a UID");
      return;
    }
    setRows(valid);
    setStep("review");
  };

  const filteredRows = useMemo(() => {
    const q = reviewSearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (
        q &&
        !r.uid.toLowerCase().includes(q) &&
        !r.contact.toLowerCase().includes(q)
      )
        return false;
      if (reviewRoleFilter !== "all" && r.role !== reviewRoleFilter)
        return false;
      return true;
    });
  }, [rows, reviewSearch, reviewRoleFilter]);

  const allFilteredSelected =
    filteredRows.length > 0 && filteredRows.every((r) => selectedIds.has(r.id));
  const someFilteredSelected = filteredRows.some((r) => selectedIds.has(r.id));
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const selectAllFiltered = () =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      filteredRows.forEach((r) => n.add(r.id));
      return n;
    });
  const clearSelection = () => setSelectedIds(new Set());
  const handleHeaderCheckbox = () => {
    if (allFilteredSelected)
      setSelectedIds((prev) => {
        const n = new Set(prev);
        filteredRows.forEach((r) => n.delete(r.id));
        return n;
      });
    else selectAllFiltered();
  };

  const applyBulkScope = () => {
    setRows((prev) =>
      prev.map((r) =>
        selectedIds.has(r.id) ? { ...r, scopeId: bulkScopeId } : r,
      ),
    );
    setSelectedIds(new Set());
    setBulkScopeId("");
  };

  const handleSubmit = async () => {
    const valid = rows.filter((r) => r.uid.trim());
    if (!valid.length) return toast.error("No members to add");

    const groups = new Map<string, AddMemberRow[]>();
    for (const row of valid) {
      const key = row.scopeId || defaultScopeId || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    setLoading(true);
    let totalAdded = 0,
      totalSkipped = 0;
    try {
      for (const [scopeKey, scopeRows] of groups) {
        const body: Parameters<typeof api.addMembers>[2] = {
          participants: scopeRows.map((r) => ({
            uid: r.uid,
            participant_identifier: r.contact || undefined,
            role: r.role as "v" | "vo" | "o" | "none",
          })),
        };
        if (scopeKey) body.scope_id = Number(scopeKey);
        const res = await api.addMembers(org.orgid, org.uid, body);
        totalAdded += res.results.filter(
          (r) => r.status === "added" || r.status === "reactivated",
        ).length;
        totalSkipped += res.results.filter(
          (r) => r.status === "skipped",
        ).length;
        res.results
          .filter((r) => r.status === "error")
          .forEach((e) => toast.error(`${e.uid}: ${e.error ?? "error"}`));
      }
      toast.success(
        `${totalAdded} added${totalSkipped ? `, ${totalSkipped} skipped` : ""}`,
      );
      onSuccess();
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to add members");
    } finally {
      setLoading(false);
    }
  };

  const validCount = rows.filter((r) => r.uid.trim()).length;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl max-h-[90dvh] flex flex-col gap-0 p-0">
        <div className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="text-base font-semibold">
            Add Members to {org.org_name}
          </DialogTitle>
          <div className="flex items-center gap-1.5 mt-3">
            {(["input", "review"] as const).map((s, i) => (
              <div key={s} className="flex items-center gap-1.5">
                {i > 0 && (
                  <span className="text-muted-foreground text-xs">──</span>
                )}
                <div
                  className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${step === s ? "text-foreground" : "text-muted-foreground"}`}
                >
                  <span
                    className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold
                    ${step === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  >
                    {i + 1}
                  </span>
                  {s === "input" ? "Enter members" : "Review & assign scopes"}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0">
          {step === "input" && (
            <Tabs value={inputTab} onValueChange={(v) => setInputTab(v as any)}>
              <TabsList>
                <TabsTrigger value="table">Manual entry</TabsTrigger>
                <TabsTrigger value="csv">CSV import</TabsTrigger>
              </TabsList>
              <TabsContent value="table" className="mt-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Enter members below. You'll assign scopes on the next screen.
                </p>
                <div className="border rounded-md overflow-hidden max-md:border-0 max-md:rounded-none max-md:overflow-visible">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          UID <span className="text-destructive">*</span>
                        </TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>
                            <Input
                              placeholder="EMP010"
                              value={row.uid}
                              onChange={(e) =>
                                updateRow(
                                  row.id,
                                  "uid",
                                  e.target.value.toUpperCase(),
                                )
                              }
                              className="h-8 font-mono"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              placeholder="alice@corp.com or 9876543210"
                              value={row.contact}
                              onChange={(e) =>
                                updateRow(row.id, "contact", e.target.value)
                              }
                              className="h-8"
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={row.role}
                              onValueChange={(v) =>
                                updateRow(row.id, "role", v)
                              }
                            >
                              <SelectTrigger className="h-8 w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="v">Voter only</SelectItem>
                                <SelectItem value="o">
                                  Organizer only
                                </SelectItem>
                                <SelectItem value="vo">Both</SelectItem>
                                <SelectItem value="none">None</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() =>
                                rows.length > 1 ? removeRow(row.id) : undefined
                              }
                              disabled={rows.length === 1}
                            >
                              ✕
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRows((prev) => [...prev, makeRow()])}
                >
                  + Add row
                </Button>
              </TabsContent>
              <TabsContent value="csv" className="mt-4 space-y-3">
                <div className="rounded-md bg-muted/40 border px-3.5 py-3 space-y-2">
                  <p className="text-xs font-semibold text-foreground">
                    Expected CSV format
                  </p>
                  <div className="font-mono text-xs text-muted-foreground space-y-0.5">
                    <p className="text-foreground">uid,contact,role</p>
                    <p>EMP001,alice@corp.com,v</p>
                    <p>EMP002,9876543210,vo</p>
                  </div>
                </div>
                <Textarea
                  placeholder={`uid,contact,role\nEMP001,alice@corp.com,v`}
                  value={csvText}
                  onChange={(e) => {
                    setCsvText(e.target.value);
                    setCsvError("");
                  }}
                  rows={9}
                  className="font-mono text-sm"
                />
                {csvError && (
                  <p className="text-xs text-destructive flex items-center gap-1.5">
                    <TriangleAlert className="w-3.5 h-3.5 flex-shrink-0" />{" "}
                    {csvError}
                  </p>
                )}
              </TabsContent>
            </Tabs>
          )}

          {step === "review" && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 px-4 py-3 flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0 pt-0.5">
                  <p className="text-sm font-semibold leading-tight">
                    Default scope
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Applied to members without an individual override
                  </p>
                </div>
                <ScopeTreeSelect
                  scopeTree={scopeTree}
                  flatScopes={flatScopes}
                  value={defaultScopeId || "all"}
                  onChange={(v) => setDefaultScopeId(v === "all" ? "" : v)}
                  allowAll
                  placeholder="Org root"
                  className="w-full sm:w-56 sm:flex-shrink-0"
                />
              </div>

              <div className="flex gap-2 flex-wrap items-center">
                <div className="relative flex-1 min-w-36">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">
                    ⌕
                  </span>
                  <Input
                    placeholder="Filter by UID or contact…"
                    value={reviewSearch}
                    onChange={(e) => setReviewSearch(e.target.value)}
                    className="pl-7 h-8 text-sm"
                  />
                  {reviewSearch && (
                    <button
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
                      onClick={() => setReviewSearch("")}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <Select
                  value={reviewRoleFilter}
                  onValueChange={(v) => setReviewRoleFilter(v as any)}
                >
                  <SelectTrigger className="w-full sm:w-36 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All roles</SelectItem>
                    <SelectItem value="v">Voter only</SelectItem>
                    <SelectItem value="o">Organizer only</SelectItem>
                    <SelectItem value="vo">Both</SelectItem>
                    <SelectItem value="none">None</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground whitespace-nowrap">
                  {filteredRows.length === rows.length
                    ? `${validCount} members`
                    : `${filteredRows.length} of ${validCount}`}
                </p>
              </div>

              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg flex-wrap">
                  <span className="text-sm font-semibold text-primary">
                    {selectedIds.size} selected — set scope:
                  </span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs font-normal gap-1 min-w-32"
                      >
                        <span
                          className={
                            bulkScopeId
                              ? "text-foreground"
                              : "text-muted-foreground"
                          }
                        >
                          {bulkScopeId
                            ? (flatScopes.find(
                                (s) => String(s.scope_id) === bulkScopeId,
                              )?.scope_name ?? "Unknown")
                            : "Pick scope…"}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          ▾
                        </span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="p-1 w-56"
                      align="start"
                      sideOffset={4}
                    >
                      <div className="max-h-60 overflow-y-auto">
                        {scopeTree.map((node) => (
                          <ScopeTreeSelectNode
                            key={node.scope_id}
                            node={node}
                            depth={0}
                            value={bulkScopeId}
                            onSelect={(v) => setBulkScopeId(v)}
                          />
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={applyBulkScope}
                    disabled={!bulkScopeId}
                  >
                    Apply to {selectedIds.size}
                  </Button>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground ml-auto"
                    onClick={clearSelection}
                  >
                    ✕ Clear
                  </button>
                </div>
              )}

              <div className="border rounded-md overflow-hidden max-md:border-0 max-md:rounded-none max-md:overflow-visible">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 pr-0">
                        <Checkbox
                          checked={allFilteredSelected}
                          ref={(el) => {
                            if (el)
                              (el as any).indeterminate =
                                someFilteredSelected && !allFilteredSelected;
                          }}
                          onCheckedChange={handleHeaderCheckbox}
                          disabled={filteredRows.length === 0}
                        />
                      </TableHead>
                      <TableHead className="w-28">UID</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead className="w-28">Role</TableHead>
                      <TableHead>
                        Scope{" "}
                        <span className="text-[10px] font-normal text-muted-foreground">
                          (click to override)
                        </span>
                      </TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center text-muted-foreground py-8 text-sm"
                        >
                          No members match your filters
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredRows.map((row) => {
                        const isSelected = selectedIds.has(row.id);
                        return (
                          <TableRow
                            key={row.id}
                            className={`transition-colors cursor-pointer ${isSelected ? "bg-primary/5" : ""}`}
                            onClick={() => toggleSelect(row.id)}
                          >
                            <TableCell
                              className="pr-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleSelect(row.id)}
                              />
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Input
                                value={row.uid}
                                onChange={(e) =>
                                  updateRow(
                                    row.id,
                                    "uid",
                                    e.target.value.toUpperCase(),
                                  )
                                }
                                className="h-7 font-mono text-xs w-full"
                                placeholder="UID"
                              />
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Input
                                value={row.contact}
                                onChange={(e) =>
                                  updateRow(row.id, "contact", e.target.value)
                                }
                                className="h-7 text-xs w-full"
                                placeholder="email or mobile"
                              />
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Select
                                value={row.role}
                                onValueChange={(v) =>
                                  updateRow(row.id, "role", v)
                                }
                              >
                                <SelectTrigger className="h-7 w-full text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="v">Voter only</SelectItem>
                                  <SelectItem value="o">
                                    Organizer only
                                  </SelectItem>
                                  <SelectItem value="vo">Both</SelectItem>
                                  <SelectItem value="none">None</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <RowScopePicker
                                rowId={row.id}
                                scopeId={row.scopeId}
                                defaultScopeId={defaultScopeId}
                                scopeTree={scopeTree}
                                flatScopes={flatScopes}
                                onChange={(id, val) =>
                                  updateRow(id, "scopeId", val)
                                }
                              />
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() =>
                                  rows.length > 1
                                    ? removeRow(row.id)
                                    : undefined
                                }
                                disabled={rows.length === 1}
                              >
                                ✕
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 sm:px-6 sm:py-4 border-t flex flex-wrap items-center justify-between gap-3">
          <div>
            {step === "review" && (
              <p className="text-xs text-muted-foreground">
                {(() => {
                  const ov = rows.filter(
                    (r) => r.uid.trim() && r.scopeId,
                  ).length;
                  const def = rows.filter(
                    (r) => r.uid.trim() && !r.scopeId,
                  ).length;
                  if (ov === 0)
                    return `All ${validCount} will use default scope`;
                  if (def === 0)
                    return `All ${validCount} have individual scopes`;
                  return `${ov} with scope override · ${def} using default`;
                })()}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === "input" ? (
              <>
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                {inputTab === "csv" ? (
                  <Button onClick={parseCsvToReview} disabled={!csvText.trim()}>
                    Parse CSV →
                  </Button>
                ) : (
                  <Button
                    onClick={goToReview}
                    disabled={!rows.some((r) => r.uid.trim())}
                  >
                    Review & assign scopes →
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep("input");
                    setSelectedIds(new Set());
                  }}
                  disabled={loading}
                >
                  ← Back
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={loading || validCount === 0}
                >
                  {loading
                    ? "Adding…"
                    : `Add ${validCount} member${validCount !== 1 ? "s" : ""}`}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Manage Org Panel ─────────────────────────────────────────────────────────
// ─── Member limit tab  ───────────────────────────────────────────────────────────────────────
// Backs ManageOrgPanel's "Member limit" tab: current limit and usage
// (member_count/member_limit), a "Request increase" action that opens the
// form, and the status of any open request. Its own component rather than
// inlined into ManageOrgPanel: the members/scope tabs above already make that function
// long, and this tab's state (history list, submit-dialog form fields) has
// nothing in common with either of theirs.
function MemberLimitTab({ org }: { org: OrgSummary }) {
  const [history, setHistory] = useState<MemberLimitRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [requestedLimit, setRequestedLimit] = useState("");
  const [justification, setJustification] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Non-null while the dialog is editing an existing NEEDS_INFO row
  // rather than starting a fresh request — set by openEditDialog(), cleared
  // by openDialog(). Drives both the dialog's copy and which api call
  // handleSubmit() makes.
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      setHistory(await api.listLimitRequestsForOrg(org.orgid, org.uid));
    } catch (e: any) {
      toast.error(e.message ?? "Failed to load member limit requests");
    } finally {
      setLoading(false);
    }
  }, [org.orgid, org.uid]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // listForOrg() returns newest-first (idx_limit_requests_orgid's own
  // ordering, see that method's comment) — the open one, if any, is
  // whichever PENDING/NEEDS_INFO row comes first, not necessarily
  // history[0] (a REJECTED/APPROVED row submitted moments later, in theory,
  // though unique_open_limit_request means there's at most one open row to
  // find regardless of position).
  const openRequest = history.find(
    (r) => r.status === "PENDING" || r.status === "NEEDS_INFO",
  );

  const usagePct =
    org.member_limit > 0
      ? Math.min(100, Math.round((org.member_count / org.member_limit) * 100))
      : 0;

  const openDialog = () => {
    setEditingRequestId(null);
    setRequestedLimit(String(org.member_limit + 1));
    setJustification("");
    setFormError(null);
    setDialogOpen(true);
  };

  // Opens the same dialog pre-filled from an existing NEEDS_INFO row
  // instead of the org's current limit — handleSubmit() below routes to
  // resubmitLimitRequest() whenever editingRequestId is set.
  const openEditDialog = (r: MemberLimitRequestRow) => {
    setEditingRequestId(r.request_id);
    setRequestedLimit(String(r.requested_limit));
    setJustification(r.justification ?? "");
    setFormError(null);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (submitting) return;
    setDialogOpen(false);
  };

  const handleSubmit = async () => {
    const limit = Number(requestedLimit);
    if (!Number.isInteger(limit) || limit <= org.member_limit) {
      setFormError(
        `Enter a whole number greater than the current limit (${org.member_limit}).`,
      );
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = editingRequestId
        ? await api.resubmitLimitRequest(org.orgid, org.uid, editingRequestId, {
            requested_limit: limit,
            justification: justification.trim() || undefined,
          })
        : await api.submitLimitRequest(org.orgid, org.uid, {
            requested_limit: limit,
            justification: justification.trim() || undefined,
          });
      toast.success(res.message);
      setDialogOpen(false);
      await fetchHistory();
    } catch (e: any) {
      setFormError(e?.message ?? "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">Member limit</CardTitle>
            <CardDescription>
              {org.member_count} of {org.member_limit} members
            </CardDescription>
          </div>
          {/* One open request per org at a time (unique_open_limit_request,
              7.1) — disabling "Request increase" while one is PENDING
              avoids a guaranteed 409 round trip, same "friendly guard in
              front of a DB-level backstop" reasoning the backend itself
              uses. NEEDS_INFO isn't a dead end the way PENDING is —
              the org can edit and resend that exact row (resubmit()), so it
              gets its own action instead of just disabling this button. */}
          {openRequest?.status === "NEEDS_INFO" ? (
            <Button size="sm" onClick={() => openEditDialog(openRequest)}>
              <Pencil className="mr-1.5 size-4" />
              Edit &amp; resend
            </Button>
          ) : (
            <Button size="sm" onClick={openDialog} disabled={!!openRequest}>
              <Plus className="mr-1.5 size-4" />
              Request increase
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={usagePct} />

          {openRequest && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">
                Open request: {openRequest.current_limit} →{" "}
                {openRequest.requested_limit}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                Status:{" "}
                {openRequest.status === "NEEDS_INFO"
                  ? "Needs more information"
                  : "Pending review"}
              </p>
              {openRequest.status === "NEEDS_INFO" &&
                openRequest.review_note && (
                  <p className="mt-1 text-muted-foreground">
                    "{openRequest.review_note}"
                  </p>
                )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Request history</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <ListSkeleton rows={3} />
          ) : history.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No member limit requests yet.
            </p>
          ) : (
            <div className="space-y-3">
              {history.map((r, i) => (
                <div key={r.request_id}>
                  {i > 0 && <Separator className="mb-3" />}
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      {r.current_limit} → {r.requested_limit}
                    </span>
                    <Badge variant="outline">
                      {r.status === "NEEDS_INFO"
                        ? "Needs info"
                        : r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString()}
                  </p>
                  {r.review_note && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      "{r.review_note}"
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingRequestId
                ? "Edit and resend your request"
                : "Request a member limit increase"}
            </DialogTitle>
            <DialogDescription>
              {editingRequestId
                ? "Update the requested limit and/or your justification, then send it back for another look."
                : "A site admin will review this request. You'll be notified once it's decided."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="requested-limit">New member limit</Label>
              <Input
                id="requested-limit"
                type="number"
                min={org.member_limit + 1}
                step={1}
                value={requestedLimit}
                onChange={(e) => setRequestedLimit(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Current limit is {org.member_limit}.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="justification">
                Justification{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="justification"
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="e.g. We're onboarding two new departments next quarter."
                rows={3}
              />
            </div>
            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDialog}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting
                ? "Submitting..."
                : editingRequestId
                  ? "Resend request"
                  : "Submit request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Role presentation ───────────────────────────────────────────────────────
// Full words instead of the old "V" / "O" / "V+O" shorthand, colour-coded so a
// column of assignments can be scanned at a glance.
type RoleKind = "both" | "voter" | "organizer" | "none";
const roleKind = (r: MemberRole): RoleKind =>
  r.is_voter && r.is_organizer
    ? "both"
    : r.is_voter
      ? "voter"
      : r.is_organizer
        ? "organizer"
        : "none";
const ROLE_NAME: Record<RoleKind, string> = {
  both: "Voter + Organizer",
  voter: "Voter",
  organizer: "Organizer",
  none: "No role",
};
const ROLE_PILL: Record<RoleKind, string> = {
  both: "bg-primary/10 text-primary",
  voter: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  organizer: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  none: "bg-muted text-muted-foreground",
};

// Every assignment a member holds, shown in full (scope name + role) rather
// than truncated to two chips. Long lists collapse behind a per-row toggle.
function AssignmentChips({
  roles,
  scopeNames,
  scopePaths,
  collapseAfter = 6,
}: {
  roles: MemberRole[];
  scopeNames: Map<number, string>;
  scopePaths: Map<number, string>;
  collapseAfter?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!roles.length)
    return (
      <span className="text-xs text-muted-foreground italic">
        No assignments
      </span>
    );
  const shown = expanded ? roles : roles.slice(0, collapseAfter);
  const hidden = roles.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((r) => {
        const kind = roleKind(r);
        const name = scopeNames.get(r.scope_id) ?? `Scope ${r.scope_id}`;
        return (
          <span
            key={r.scope_id}
            title={`${scopePaths.get(r.scope_id) ?? name} — ${ROLE_NAME[kind]}`}
            className="inline-flex items-stretch overflow-hidden rounded-md border bg-card text-xs leading-none whitespace-nowrap"
          >
            <span className="px-2 py-1.5 font-medium">{name}</span>
            <span
              className={`border-l px-1.5 py-1.5 text-[11px] font-semibold ${ROLE_PILL[kind]}`}
            >
              {ROLE_NAME[kind]}
            </span>
          </span>
        );
      })}
      {(hidden > 0 || (expanded && roles.length > collapseAfter)) && (
        <button
          type="button"
          className="rounded-md px-1.5 py-1 text-xs font-medium text-primary hover:bg-primary/10"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {expanded ? "Show less" : `+${hidden} more`}
        </button>
      )}
    </div>
  );
}

// Clickable summary tiles above the member table. Each one doubles as a
// quick role filter, so "how many organizers do we have?" and "show me
// them" are one click.
function MemberStats({
  stats,
  active,
  onPick,
}: {
  stats: {
    total: number;
    voters: number;
    organizers: number;
    unassigned: number;
  };
  active: string;
  onPick: (v: "all" | "voter" | "organizer" | "none") => void;
}) {
  const tiles: Array<{
    key: "all" | "voter" | "organizer" | "none";
    label: string;
    value: number;
  }> = [
    { key: "all", label: "All members", value: stats.total },
    { key: "voter", label: "Voters", value: stats.voters },
    { key: "organizer", label: "Organizers", value: stats.organizers },
    { key: "none", label: "No assignments", value: stats.unassigned },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
      {tiles.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onPick(isActive && t.key !== "all" ? "all" : t.key)}
            aria-pressed={isActive}
            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
              isActive
                ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                : "bg-card hover:bg-accent/50"
            }`}
          >
            <p className="text-2xl font-bold tabular-nums leading-none">
              {t.value}
            </p>
            <p className="mt-1.5 text-xs font-medium text-muted-foreground">
              {t.label}
            </p>
          </button>
        );
      })}
    </div>
  );
}

const PAGE_SIZES = [10, 25, 50, 100];
type SortKey = "uid-asc" | "uid-desc" | "scopes-desc" | "scopes-asc";

function ManageOrgPanel({
  org,
  onBack,
}: {
  org: OrgSummary;
  // Present for UNIFIED sessions (they arrived here from the org picker);
  // omitted for ORG sessions, which only ever have the one org.
  onBack?: () => void;
}) {
  const [activeTab, setActiveTab] = useState("members");
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<
    "all" | "organizer" | "organizer-only" | "voter" | "voter-only" | "none"
  >("all");
  const [scopeFilter, setScopeFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortKey>("uid-asc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [copied, setCopied] = useState(false);
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set());
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [managingMember, setManagingMember] = useState<OrgMember | null>(null);
  const [removingUid, setRemovingUid] = useState<string | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditInitialTab, setBulkEditInitialTab] = useState<
    "update" | "move" | "add"
  >("update");
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false);
  const [bulkRemoveLoading, setBulkRemoveLoading] = useState(false);
  const [scopeTree, setScopeTree] = useState<ScopeNode[]>([]);
  const [flatScopes, setFlatScopes] = useState<ScopeNode[]>([]);
  const [selectedScope, setSelectedScope] = useState<ScopeNode | null>(null);
  const [scopeLoading, setScopeLoading] = useState(false);

  const fetchMembers = useCallback(async () => {
    setMembersLoading(true);
    try {
      // Api.getMembers now returns OrgMemberWithRoles[] directly — no cast needed.
      setMembers(await api.getMembers(org.orgid, org.uid, {}));
    } catch (e: any) {
      toast.error(e.message ?? "Failed to load members");
    } finally {
      setMembersLoading(false);
    }
  }, [org.orgid, org.uid]);

  // SelectedScope was used inside fetchScopes but missing from its deps array,
  // causing a stale closure where the scope panel wouldn't re-highlight after a refresh.
  // Using a functional setter avoids capturing the stale value at all.
  const fetchScopes = useCallback(async () => {
    setScopeLoading(true);
    try {
      const data = (await api.getScopeTree(org.orgid, org.uid)) as ScopeNode[];
      setScopeTree(data);
      const flat = flattenTree(data);
      setFlatScopes(flat);
      // Use functional update so we always compare against the latest selectedScope,
      // not the one captured when fetchScopes was last created.
      setSelectedScope((prev) =>
        prev ? (flat.find((s) => s.scope_id === prev.scope_id) ?? null) : null,
      );
    } catch (e: any) {
      toast.error(e.message ?? "Failed to load scope tree");
    } finally {
      setScopeLoading(false);
    }
  }, [org.orgid, org.uid]);

  useEffect(() => {
    if (activeTab === "members") fetchMembers();
    if (activeTab === "scope") fetchScopes();
  }, [activeTab, org.orgid, fetchMembers, fetchScopes]);

  // fetchScopes must be in the dependency array (exhaustive-deps). It is
  // memoized by useCallback, so listing it does not cause extra refetches.
  useEffect(() => {
    if (activeTab === "members") fetchScopes();
  }, [activeTab, fetchScopes]);

  useEffect(() => {
    setSelectedUids(new Set());
  }, [searchQuery, roleFilter, scopeFilter]);

  // Back to the first page whenever the result set or its ordering changes.
  useEffect(() => {
    setPage(0);
  }, [searchQuery, roleFilter, scopeFilter, sortBy, pageSize]);

  // ── Scope lookups (names + "Parent › Child" paths for chip tooltips) ─────────
  const scopeNames = useMemo(
    () => new Map(flatScopes.map((s) => [s.scope_id, s.scope_name])),
    [flatScopes],
  );
  const scopePaths = useMemo(() => {
    const byId = new Map(flatScopes.map((s) => [s.scope_id, s]));
    const out = new Map<number, string>();
    flatScopes.forEach((s) => {
      const parts: string[] = [];
      let cur: ScopeNode | undefined = s;
      let guard = 0;
      while (cur && guard++ < 25) {
        parts.unshift(cur.scope_name);
        cur =
          cur.parent_scope_id != null
            ? byId.get(cur.parent_scope_id)
            : undefined;
      }
      out.set(s.scope_id, parts.join(" › "));
    });
    return out;
  }, [flatScopes]);

  // ── Stats ─────────────────────────────────────────────────────────────────────
  const stats = useMemo(
    () => ({
      total: members.length,
      voters: members.filter(hasVoter).length,
      organizers: members.filter(hasOrganizer).length,
      unassigned: members.filter((m) => !hasVoter(m) && !hasOrganizer(m))
        .length,
    }),
    [members],
  );

  // ── Filtering + sorting ───────────────────────────────────────────────────────
  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return members.filter((m) => {
      const contact = `${m.email ?? ""} ${m.mobile ?? ""}`.toLowerCase();
      if (q && !m.uid.toLowerCase().includes(q) && !contact.includes(q))
        return false;
      if (roleFilter === "organizer" && !hasOrganizer(m)) return false;
      if (roleFilter === "organizer-only" && (!hasOrganizer(m) || hasVoter(m)))
        return false;
      if (roleFilter === "voter" && !hasVoter(m)) return false;
      if (roleFilter === "voter-only" && (hasOrganizer(m) || !hasVoter(m)))
        return false;
      if (roleFilter === "none" && (hasVoter(m) || hasOrganizer(m)))
        return false;
      if (
        scopeFilter !== "all" &&
        !m.roles.some((r) => String(r.scope_id) === scopeFilter)
      )
        return false;
      return true;
    });
  }, [members, searchQuery, roleFilter, scopeFilter]);

  const sortedMembers = useMemo(() => {
    const byUid = (a: OrgMember, b: OrgMember) =>
      a.uid.localeCompare(b.uid, undefined, { numeric: true });
    const arr = [...filteredMembers];
    switch (sortBy) {
      case "uid-desc":
        arr.sort((a, b) => byUid(b, a));
        break;
      case "scopes-desc":
        arr.sort((a, b) => b.roles.length - a.roles.length || byUid(a, b));
        break;
      case "scopes-asc":
        arr.sort((a, b) => a.roles.length - b.roles.length || byUid(a, b));
        break;
      default:
        arr.sort(byUid);
    }
    return arr;
  }, [filteredMembers, sortBy]);

  // ── Pagination ────────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(sortedMembers.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * pageSize;
  const pagedMembers = sortedMembers.slice(pageStart, pageStart + pageSize);

  // ── Selection ─────────────────────────────────────────────────────────────────
  // The header checkbox toggles the rows on the current page (like most
  // mail/admin tools); BulkActionBar's "Select all N" still reaches every
  // filtered row across pages.
  const selectableUids = filteredMembers
    .map((m) => m.uid)
    .filter((uid) => uid !== org.uid);
  const pageSelectableUids = pagedMembers
    .map((m) => m.uid)
    .filter((uid) => uid !== org.uid);
  const allPageSelected =
    pageSelectableUids.length > 0 &&
    pageSelectableUids.every((uid) => selectedUids.has(uid));
  const somePageSelected = pageSelectableUids.some((uid) =>
    selectedUids.has(uid),
  );

  const toggleSelect = (uid: string) =>
    setSelectedUids((prev) => {
      const n = new Set(prev);
      n.has(uid) ? n.delete(uid) : n.add(uid);
      return n;
    });
  const selectAllFiltered = () => setSelectedUids(new Set(selectableUids));
  const clearSelection = () => setSelectedUids(new Set());
  const handleHeaderCheckbox = () =>
    setSelectedUids((prev) => {
      const n = new Set(prev);
      if (allPageSelected) pageSelectableUids.forEach((uid) => n.delete(uid));
      else pageSelectableUids.forEach((uid) => n.add(uid));
      return n;
    });

  // ── Remove ────────────────────────────────────────────────────────────────────
  const handleRemoveMember = async () => {
    if (!removingUid) return;
    setRemoveLoading(true);
    try {
      await api.removeMember(org.orgid, org.uid, removingUid);
      toast.success(`${removingUid} removed`);
      setRemovingUid(null);
      fetchMembers();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to remove member");
    } finally {
      setRemoveLoading(false);
    }
  };

  const handleBulkRemove = async () => {
    setBulkRemoveLoading(true);
    let successCount = 0;
    for (const uid of Array.from(selectedUids)) {
      try {
        await api.removeMember(org.orgid, org.uid, uid);
        successCount++;
      } catch (e: any) {
        toast.error(`${uid}: ${e.message ?? "error"}`);
      }
    }
    if (successCount > 0)
      toast.success(
        `Removed ${successCount} member${successCount !== 1 ? "s" : ""}`,
      );
    setBulkRemoveLoading(false);
    setBulkRemoveOpen(false);
    clearSelection();
    fetchMembers();
  };

  const hasActiveFilters =
    !!searchQuery.trim() || roleFilter !== "all" || scopeFilter !== "all";
  const clearFilters = () => {
    setSearchQuery("");
    setRoleFilter("all");
    setScopeFilter("all");
  };

  const copyOrgId = async () => {
    try {
      await navigator.clipboard.writeText(org.orgid);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  // Capacity: prefer the live member list once loaded, else the figure that
  // came back with the org list.
  const usedCount = members.length > 0 ? members.length : org.member_count;
  const capacityPct =
    org.member_limit > 0
      ? Math.min(100, Math.round((usedCount / org.member_limit) * 100))
      : 0;

  const tabTriggerCls =
    "flex-none h-auto gap-2 max-sm:[&>svg]:hidden rounded-none border-0 border-b-2 border-transparent px-3 py-2.5 -mb-px text-muted-foreground hover:text-foreground " +
    "data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:border-primary data-[state=active]:shadow-none " +
    "dark:data-[state=active]:bg-transparent dark:data-[state=active]:border-primary dark:text-muted-foreground";

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {onBack && (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="w-4 h-4" /> All organizations
        </Button>
      )}

      {/* ── Org header ── */}
      <div className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary sm:size-12">
              <Building2 className="size-5 sm:size-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold leading-tight tracking-tight break-words">
                  {org.org_name}
                </h2>
                <Badge variant={org.is_active ? "default" : "secondary"}>
                  {org.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                <button
                  type="button"
                  onClick={copyOrgId}
                  title="Copy organization ID"
                  className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-0.5 font-mono hover:bg-accent hover:text-foreground"
                >
                  {org.orgid}
                  {copied ? (
                    <Check className="w-3 h-3 text-green-600" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
                <span>
                  Your UID:{" "}
                  <span className="font-mono font-semibold text-foreground">
                    {org.uid}
                  </span>
                </span>
                {org.org_email && (
                  <span className="truncate">{org.org_email}</span>
                )}
              </div>
            </div>
          </div>
          {org.member_limit > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab("limits")}
              title="View member limit"
              className="w-full shrink-0 rounded-lg border bg-background px-4 py-2.5 text-left transition-colors hover:bg-accent/50 md:w-56"
            >
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-muted-foreground">Capacity</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {usedCount} / {org.member_limit}
                </span>
              </div>
              <Progress value={capacityPct} className="mt-2 h-1.5" />
            </button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-0">
        <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b bg-transparent p-0">
          <TabsTrigger value="members" className={tabTriggerCls}>
            <Users /> Members
            {members.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-none text-muted-foreground">
                {members.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="scope" className={tabTriggerCls}>
            <Network /> Scope Tree
          </TabsTrigger>
          {/* Current limit + usage, "Request
              increase", and status of any open request — see
              MemberLimitTab's own header comment. */}
          <TabsTrigger value="limits" className={tabTriggerCls}>
            <Gauge /> Member Limit
          </TabsTrigger>
        </TabsList>

        {/* ── MEMBERS TAB ── */}
        <TabsContent value="members" className="mt-5 space-y-4">
          {members.length > 0 && (
            <MemberStats
              stats={stats}
              active={roleFilter}
              onPick={(v) => setRoleFilter(v)}
            />
          )}

          {/* Toolbar */}
          <div className="rounded-xl border bg-card p-3 sm:p-4">
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by UID, email or mobile…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8"
                />
                {searchQuery && (
                  <button
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setSearchQuery("")}
                    title="Clear search"
                    aria-label="Clear search"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:flex xl:items-center">
                <Select
                  value={roleFilter}
                  onValueChange={(v) => setRoleFilter(v as any)}
                >
                  <SelectTrigger className="w-full xl:w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All roles</SelectItem>
                    <SelectItem value="voter">Has Voter</SelectItem>
                    <SelectItem value="voter-only">Voter only</SelectItem>
                    <SelectItem value="organizer">Has Organizer</SelectItem>
                    <SelectItem value="organizer-only">
                      Organizer only
                    </SelectItem>
                    <SelectItem value="none">No roles</SelectItem>
                  </SelectContent>
                </Select>
                <ScopeTreeSelect
                  scopeTree={scopeTree}
                  flatScopes={flatScopes}
                  value={scopeFilter}
                  onChange={setScopeFilter}
                  allowAll
                  placeholder="All scopes"
                  className="w-full xl:w-48"
                />
                <Select
                  value={sortBy}
                  onValueChange={(v) => setSortBy(v as SortKey)}
                >
                  <SelectTrigger className="col-span-2 w-full sm:col-span-1 xl:w-48">
                    <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="uid-asc">UID · A → Z</SelectItem>
                    <SelectItem value="uid-desc">UID · Z → A</SelectItem>
                    <SelectItem value="scopes-desc">
                      Most assignments
                    </SelectItem>
                    <SelectItem value="scopes-asc">
                      Fewest assignments
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 xl:ml-auto">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={fetchMembers}
                  disabled={membersLoading}
                  title="Refresh members"
                  aria-label="Refresh members"
                >
                  <RefreshCw
                    className={`w-4 h-4 ${membersLoading ? "animate-spin" : ""}`}
                  />
                </Button>
                <Button
                  className="flex-1 gap-1.5 xl:flex-none"
                  onClick={() => setAddMemberOpen(true)}
                >
                  <UserPlus className="w-4 h-4" /> Add Members
                </Button>
              </div>
            </div>
          </div>

          {/* Result summary */}
          {members.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5">
              <p className="text-sm text-muted-foreground">
                {sortedMembers.length === 0 ? (
                  "No matching members"
                ) : (
                  <>
                    Showing{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {pageStart + 1}–{pageStart + pagedMembers.length}
                    </span>{" "}
                    of{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {sortedMembers.length}
                    </span>
                    {sortedMembers.length !== members.length &&
                      ` (filtered from ${members.length})`}{" "}
                    member{sortedMembers.length !== 1 ? "s" : ""}
                  </>
                )}
              </p>
              {hasActiveFilters && (
                <button
                  className="text-sm font-medium text-primary hover:underline"
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              )}
            </div>
          )}

          {selectedUids.size > 0 && (
            <div className="md:sticky md:top-[4.5rem] md:z-30 md:shadow-sm md:rounded-lg">
              <BulkActionBar
                selectedCount={selectedUids.size}
                totalCount={selectableUids.length}
                onSelectAll={selectAllFiltered}
                onClearSelection={clearSelection}
                onBulkEdit={() => {
                  setBulkEditInitialTab("update");
                  setBulkEditOpen(true);
                }}
                onBulkMove={() => {
                  setBulkEditInitialTab("move");
                  setBulkEditOpen(true);
                }}
                onBulkRemove={() => setBulkRemoveOpen(true)}
              />
            </div>
          )}

          {membersLoading && members.length === 0 ? (
            <ListSkeleton rows={6} />
          ) : members.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-card py-14 text-center">
              <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
                <Users className="size-6" />
              </div>
              <p className="font-medium">No members yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add people to {org.org_name} to start assigning scopes and
                roles.
              </p>
              <Button
                className="mt-4 gap-1.5"
                onClick={() => setAddMemberOpen(true)}
              >
                <UserPlus className="w-4 h-4" /> Add Members
              </Button>
            </div>
          ) : (
            <div className="rounded-xl border bg-card max-md:border-0 max-md:bg-transparent">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                    <TableHead className="w-12 pl-4 pr-0">
                      <Checkbox
                        checked={allPageSelected}
                        ref={(el) => {
                          if (el)
                            (el as any).indeterminate =
                              somePageSelected && !allPageSelected;
                        }}
                        onCheckedChange={handleHeaderCheckbox}
                        disabled={pageSelectableUids.length === 0}
                        aria-label="Select all on this page"
                      />
                    </TableHead>
                    <TableHead className="w-44">UID</TableHead>
                    <TableHead className="w-72">Contact</TableHead>
                    <TableHead>Scope Assignments</TableHead>
                    <TableHead className="w-36 pr-4 text-right">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedMembers.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="py-12 text-center text-muted-foreground"
                      >
                        <div className="space-y-1">
                          <p>No members match your filters.</p>
                          <button
                            className="text-sm text-primary hover:underline"
                            onClick={clearFilters}
                          >
                            Clear filters
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagedMembers.map((m) => {
                      const isSelected = selectedUids.has(m.uid);
                      const isSelf = m.uid === org.uid;
                      return (
                        <TableRow
                          key={m.uid}
                          className={`cursor-pointer align-top transition-colors ${
                            isSelected ? "bg-primary/5 hover:bg-primary/10" : ""
                          }`}
                          onClick={() => setManagingMember(m)}
                        >
                          <TableCell
                            className="w-12 pl-4 pr-0 md:py-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() =>
                                !isSelf && toggleSelect(m.uid)
                              }
                              disabled={isSelf}
                              aria-label={`Select ${m.uid}`}
                            />
                          </TableCell>
                          <TableCell className="font-mono text-sm font-semibold md:py-3">
                            {m.uid}
                            {isSelf && (
                              <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-primary">
                                You
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground md:py-3">
                            {m.email || m.mobile ? (
                              <div className="min-w-0">
                                {m.email && (
                                  <p className="truncate text-foreground/80">
                                    {m.email}
                                  </p>
                                )}
                                {m.mobile && (
                                  <p className="truncate text-xs">{m.mobile}</p>
                                )}
                              </div>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="md:min-w-[320px] md:whitespace-normal md:py-3">
                            <AssignmentChips
                              roles={m.roles}
                              scopeNames={scopeNames}
                              scopePaths={scopePaths}
                            />
                          </TableCell>
                          <TableCell
                            className="pr-4 text-right md:py-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-0.5">
                              <QuickMoveButton
                                member={m}
                                org={org}
                                scopeTree={scopeTree}
                                flatScopes={flatScopes}
                                onManageInstead={() => setManagingMember(m)}
                                onSuccess={fetchMembers}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                                onClick={() => setManagingMember(m)}
                                title="Manage assignments"
                                aria-label={`Manage assignments for ${m.uid}`}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => setRemovingUid(m.uid)}
                                disabled={isSelf}
                                title={
                                  isSelf
                                    ? "You can't remove yourself"
                                    : "Remove member"
                                }
                                aria-label={`Remove ${m.uid}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>

              {/* Pagination */}
              {sortedMembers.length > 0 && (
                <div className="flex flex-col gap-3 border-t bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between max-md:mt-3 max-md:rounded-xl max-md:border max-md:bg-card">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>Rows per page</span>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(v) => setPageSize(Number(v))}
                    >
                      <SelectTrigger className="h-8 w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZES.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between gap-2 sm:justify-end">
                    <span className="text-sm text-muted-foreground tabular-nums">
                      Page {safePage + 1} of {totalPages}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-8"
                        onClick={() => setPage(0)}
                        disabled={safePage === 0}
                        aria-label="First page"
                      >
                        <ChevronsLeft className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-8"
                        onClick={() => setPage(safePage - 1)}
                        disabled={safePage === 0}
                        aria-label="Previous page"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-8"
                        onClick={() => setPage(safePage + 1)}
                        disabled={safePage >= totalPages - 1}
                        aria-label="Next page"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-8"
                        onClick={() => setPage(totalPages - 1)}
                        disabled={safePage >= totalPages - 1}
                        aria-label="Last page"
                      >
                        <ChevronsRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <AddMembersDialog
            open={addMemberOpen}
            org={org}
            scopeTree={scopeTree}
            flatScopes={flatScopes}
            onClose={() => setAddMemberOpen(false)}
            onSuccess={fetchMembers}
          />

          <ManageAssignmentsDialog
            open={managingMember !== null}
            member={managingMember}
            org={org}
            scopeTree={scopeTree}
            flatScopes={flatScopes}
            onClose={() => setManagingMember(null)}
            onSuccess={() => {
              fetchMembers();
            }}
          />

          <BulkEditDialog
            open={bulkEditOpen}
            selectedUids={Array.from(selectedUids)}
            members={members}
            org={org}
            scopeTree={scopeTree}
            flatScopes={flatScopes}
            initialTab={bulkEditInitialTab}
            onClose={() => setBulkEditOpen(false)}
            onSuccess={() => {
              clearSelection();
              fetchMembers();
            }}
          />

          <AlertDialog
            open={removingUid !== null}
            onOpenChange={(o) => !o && setRemovingUid(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {removingUid}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This member and all their scope assignments will be
                  deactivated from {org.org_name}. They can be re-added later.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={removeLoading}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleRemoveMember}
                  disabled={removeLoading}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {removeLoading ? "Removing…" : "Remove Member"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog
            open={bulkRemoveOpen}
            onOpenChange={(o) => !o && setBulkRemoveOpen(false)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Remove {selectedUids.size} member
                  {selectedUids.size !== 1 ? "s" : ""}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  These members and all their scope assignments will be
                  deactivated from {org.org_name}.
                  <div className="mt-2 max-h-24 overflow-y-auto font-mono text-xs bg-muted rounded p-2 space-y-0.5">
                    {Array.from(selectedUids).map((uid) => (
                      <div key={uid}>{uid}</div>
                    ))}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={bulkRemoveLoading}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleBulkRemove}
                  disabled={bulkRemoveLoading}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {bulkRemoveLoading
                    ? "Removing…"
                    : `Remove ${selectedUids.size} member${selectedUids.size !== 1 ? "s" : ""}`}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>

        {/* ── SCOPE TAB ── */}
        <TabsContent value="scope" className="mt-5">
          {scopeLoading ? (
            <ListSkeleton rows={5} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2 pt-4 px-4 sm:pt-4 sm:px-4">
                  <CardTitle className="text-sm">Hierarchy</CardTitle>
                  <CardDescription className="text-xs">
                    Click a node to view or edit
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-2 pb-4 sm:px-2">
                  {scopeTree.length === 0 ? (
                    <p className="text-sm text-muted-foreground px-2">
                      No scopes found
                    </p>
                  ) : (
                    scopeTree.map((root) => (
                      <ScopeTreeNode
                        key={root.scope_id}
                        node={root}
                        depth={0}
                        selectedId={selectedScope?.scope_id ?? null}
                        onSelect={setSelectedScope}
                      />
                    ))
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2 pt-4 px-4 sm:pt-4 sm:px-4">
                  <CardTitle className="text-sm">
                    {selectedScope ? "Scope Actions" : "Select a Scope"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 sm:px-4">
                  {!selectedScope ? (
                    <p className="text-sm text-muted-foreground">
                      Select a node from the hierarchy to rename, add children,
                      or delete it.
                    </p>
                  ) : (
                    <ScopeActionsPanel
                      key={selectedScope.scope_id}
                      node={selectedScope}
                      org={org}
                      flatScopes={flatScopes}
                      members={members}
                      onRefresh={fetchScopes}
                      onViewMembers={(scopeId) => {
                        setScopeFilter(String(scopeId));
                        setActiveTab("members");
                      }}
                    />
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ── MEMBER LIMIT TAB  ── */}
        <TabsContent value="limits" className="mt-5">
          <MemberLimitTab org={org} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Org picker card ──────────────────────────────────────────────────────────
function OrgPickerCard({
  org,
  onOpen,
}: {
  org: OrgSummary;
  onOpen: () => void;
}) {
  const pct =
    org.member_limit > 0
      ? Math.min(100, Math.round((org.member_count / org.member_limit) * 100))
      : 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full flex-col gap-5 rounded-xl border bg-card p-4 text-left transition-all hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Building2 className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-semibold leading-tight">
            {org.org_name}
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {org.orgid}
          </p>
        </div>
        <Badge
          variant={org.is_active ? "default" : "secondary"}
          className="shrink-0"
        >
          {org.is_active ? "Active" : "Inactive"}
        </Badge>
      </div>

      {org.member_limit > 0 && (
        <div>
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Members</span>
            <span className="font-semibold tabular-nums">
              {org.member_count} / {org.member_limit}
            </span>
          </div>
          <Progress value={pct} className="mt-1.5 h-1.5" />
        </div>
      )}

      <div className="mt-auto flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
        <span>
          Your UID:{" "}
          <span className="font-mono font-semibold text-foreground">
            {org.uid}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-primary transition-all group-hover:gap-2">
          Manage <ChevronRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </button>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────
export function ManageOrganizationsView() {
  const { session } = useAppContext();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgQuery, setOrgQuery] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);
  // The open organization lives in the URL (?org=ORGID) rather than local
  // state, so the browser's Back button returns to the picker, a refresh
  // keeps you where you were, and a specific org can be linked to.
  const [searchParams, setSearchParams] = useSearchParams();
  // This requester's own org-request history — fetched only for
  // UNIFIED sessions (the only session type that can ever submit one), so
  // an ORG session doesn't pay for a fetch it has no use for. Drives the
  // "Request Org" button's own cooldown pre-check below, and is passed into
  // SubmitOrgRequestModal for its open-name duplicate check.
  const [myRequests, setMyRequests] = useState<OrgRequestMine[]>([]);

  const isUnified = session?.type === "UNIFIED";
  // UNIFIED and ORG (this app's only real session types — SITEADMIN lives
  // on the separate admin app) both reach the full page below
  // unconditionally.
  const isOrg = session?.type === "ORG";

  const fetchOrgs = async () => {
    setLoading(true);
    try {
      const data = (await api.getMyOrgs()) as OrgSummary[];
      const filtered = isOrg
        ? data.filter((o) => o.orgid === session?.orgid)
        : data;
      setOrgs(filtered);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to load organizations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrgs();
  }, []);

  // Separate effect/fetch from fetchOrgs() above — different
  // endpoint, different session-type gate (isUnified only), and refetched
  // on its own after a successful submission (see fetchMyRequests passed as
  // part of onSuccess below) without needing to also redo the orgs fetch.
  const fetchMyRequests = async () => {
    if (!isUnified) return;
    try {
      setMyRequests(await api.listMyOrgRequests());
    } catch {
      // Non-critical: worst case the cooldown/duplicate pre-checks below
      // just don't fire, and the backend still enforces both for real at
      // submit time. Not worth surfacing a toast for a background fetch
      // that only feeds a UX nicety.
    }
  };

  useEffect(() => {
    fetchMyRequests();
  }, [isUnified]);

  // Mirrors org-requests.service.ts's own cooldown check
  // (SUBMIT_COOLDOWN_MS from this file's own constants above) — same "look
  // at the single most recent row" shape, since listMyOrgRequests() already
  // comes back ordered newest-first.
  const mostRecentRequest = myRequests[0];
  const cooldownUntil = mostRecentRequest
    ? new Date(mostRecentRequest.created_at).getTime() + SUBMIT_COOLDOWN_MS
    : 0;
  const cooldownRemainingMs = cooldownUntil - Date.now();
  const isCoolingDown = cooldownRemainingMs > 0;

  const requestOrgLabel = isCoolingDown
    ? `Available in ${formatCooldownRemaining(cooldownRemainingMs)}`
    : "Request Org";

  // ORG sessions only ever have one org, so they skip the picker entirely.
  const selectedOrgId = searchParams.get("org");
  const selectedOrg: OrgSummary | null = isOrg
    ? (orgs[0] ?? null)
    : (orgs.find((o) => o.orgid === selectedOrgId) ?? null);
  const showingDetail = !loading && selectedOrg !== null;

  const openOrg = (orgid: string) => setSearchParams({ org: orgid });
  const closeOrg = () => setSearchParams({});

  const visibleOrgs = orgQuery.trim()
    ? orgs.filter((o) =>
        `${o.org_name} ${o.orgid}`
          .toLowerCase()
          .includes(orgQuery.trim().toLowerCase()),
      )
    : orgs;

  return (
    <div className="mx-auto w-full">
      {/* Page header — only on the picker; the org view brings its own. */}
      {!showingDetail && (
        <div className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight mb-1">
              Organizations
            </h1>
            <p className="text-sm text-muted-foreground">
              {isUnified
                ? "Choose an organization to view and manage its members"
                : "Managing your organization"}
            </p>
          </div>
          {isUnified && (
            // Demoted from a filled primary button to outline — this
            // one is shown on every visit regardless of whether the user
            // already organizes several orgs, so it shouldn't carry the same
            // visual weight as a true empty-state CTA (see the "Request your
            // first organization" button below, which stays primary because
            // it only appears when there's genuinely nothing else to do on
            // this page). Also disabled with a countdown label during the
            // backend's own submission cooldown, instead of only failing
            // after the user fills out the whole form.
            <Button
              variant="outline"
              onClick={() => setRegisterOpen(true)}
              disabled={isCoolingDown}
              className="flex-shrink-0 gap-1.5"
              title={
                isCoolingDown
                  ? "You can submit another organization request once the cooldown ends"
                  : undefined
              }
            >
              <Plus className="w-4 h-4" /> {requestOrgLabel}
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <ListSkeleton rows={4} />
      ) : orgs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            {isUnified ? (
              <>
                <p className="text-muted-foreground">
                  You don't have any organizations yet.
                </p>
                <Button
                  onClick={() => setRegisterOpen(true)}
                  disabled={isCoolingDown}
                >
                  {isCoolingDown
                    ? `Available in ${formatCooldownRemaining(cooldownRemainingMs)}`
                    : "Request your first organization"}
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground">
                No organization found for this session. You may not have an
                Organizer role.
              </p>
            )}
          </CardContent>
        </Card>
      ) : selectedOrg ? (
        // The whole content area belongs to the selected org — no picker
        // beside it. UNIFIED users get a Back button; ORG sessions don't.
        <ManageOrgPanel
          key={selectedOrg.orgid}
          org={selectedOrg}
          onBack={isOrg ? undefined : closeOrg}
        />
      ) : (
        <div className="space-y-4">
          {orgs.length > 6 && (
            <div className="relative max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search organizations…"
                value={orgQuery}
                onChange={(e) => setOrgQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          )}
          {visibleOrgs.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No organizations match "{orgQuery}".
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleOrgs.map((org) => (
                <OrgPickerCard
                  key={org.orgid}
                  org={org}
                  onOpen={() => openOrg(org.orgid)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {isUnified && (
        <SubmitOrgRequestModal
          open={registerOpen}
          onClose={() => setRegisterOpen(false)}
          onSuccess={() => {
            fetchOrgs();
            fetchMyRequests();
          }}
          myRequests={myRequests}
        />
      )}
    </div>
  );
}
