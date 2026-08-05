import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "../../lib/api";
import type { MemberRole, OrgMemberWithRoles } from "../../lib/api";
import { useAppContext } from "../context/app-context";
import type { OrgSummary, ScopeNode } from "../context/app-context";
import { toast } from "sonner";

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
} from "lucide-react";
import React from "react";

// FIX: use OrgMemberWithRoles from api.tsx instead of redefining a local OrgMember.
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
}: {
  node: ScopeNode;
  depth: number;
  value: string;
  onSelect: (v: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isSelected = value === String(node.scope_id);
  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1.5 rounded-md cursor-pointer text-sm select-none transition-colors
          ${isSelected ? "bg-primary text-primary-foreground" : "hover:bg-accent text-foreground"}`}
        style={{ paddingLeft: `${depth * 14 + 6}px`, paddingRight: 6 }}
        onClick={() => onSelect(String(node.scope_id))}
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
        <span className="truncate flex-1">{node.scope_name}</span>
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

  const filterTree = (nodes: ScopeNode[]): ScopeNode[] =>
    nodes
      .filter((n) => !exclude.includes(n.scope_id))
      .map((n) => ({ ...n, children: filterTree(n.children ?? []) }));

  const filteredTree = exclude.length ? filterTree(scopeTree) : scopeTree;

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
          {filteredTree.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2.5 py-2">
              No scopes available
            </p>
          ) : (
            filteredTree.map((node) => (
              <ScopeTreeSelectNode
                key={node.scope_id}
                node={node}
                depth={0}
                value={value}
                onSelect={handleSelect}
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

// ─── Register Org Modal ───────────────────────────────────────────────────────
function RegisterOrgModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [orgName, setOrgName] = useState("");
  const [preferredOrgId, setPreferredOrgId] = useState("");
  const [callerUid, setCallerUid] = useState("");
  const [callerIdentifier, setCallerIdentifier] = useState("");
  const [memberTab, setMemberTab] = useState<"table" | "csv">("table");
  const [csvText, setCsvText] = useState("");
  // FIX: role type was 'v' | 'vo' — missing 'o' and 'none' which are valid backend values.
  const [tableRows, setTableRows] = useState([
    { uid: "", contact: "", role: "v" as "v" | "vo" | "o" | "none" },
  ]);
  const [loading, setLoading] = useState(false);

  const suggestedOrgId =
    preferredOrgId.trim() || (orgName ? generateOrgId(orgName) : "");
  const addRow = () =>
    setTableRows((r) => [...r, { uid: "", contact: "", role: "v" as const }]);
  const updateRow = (idx: number, field: string, val: string) =>
    setTableRows((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, [field]: val } : r)),
    );
  const removeRow = (idx: number) =>
    setTableRows((rows) => rows.filter((_, i) => i !== idx));

  const buildParticipants = () =>
    memberTab === "csv"
      ? parseCsv(csvText)
          .filter((r) => (r.uid ?? "").trim())
          .map((r) => ({
            uid: (r.uid ?? "").trim().toUpperCase(),
            participant_identifier:
              (r.contact ?? r.email ?? r.mobile ?? "").trim() || undefined,
            // FIX: cast now includes 'o' and 'none' which the backend ParticipantRowDto supports.
            role: (r.role as "v" | "vo" | "o" | "none") || "v",
          }))
      : tableRows
          .filter((r) => r.uid.trim())
          .map((r) => ({
            uid: r.uid.trim().toUpperCase(),
            participant_identifier: r.contact.trim() || undefined,
            role: r.role,
          }));

  const handleSubmit = async () => {
    if (!orgName.trim()) return toast.error("Organization name is required");
    if (!callerUid.trim())
      return toast.error("Your UID in this org is required");
    if (!callerIdentifier.trim())
      return toast.error("Your mobile or email is required");
    setLoading(true);
    try {
      const result = await api.registerOrg({
        org_name: orgName.trim(),
        preferred_orgid: preferredOrgId.trim() || undefined,
        caller_uid: callerUid.trim().toUpperCase(),
        caller_identifier: callerIdentifier.trim(),
        participants: buildParticipants(),
      });
      toast.success(
        `Organization "${result.org_name}" registered as ${result.orgid}`,
      );
      onSuccess();
      onClose();
      setOrgName("");
      setPreferredOrgId("");
      setCallerUid("");
      setCallerIdentifier("");
      setTableRows([{ uid: "", contact: "", role: "v" }]);
      setCsvText("");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to register organization");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register New Organization</DialogTitle>
          <DialogDescription>
            You will be assigned Voter + Organizer roles at the ROOT scope
            automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 mt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>
                Organization Name <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="e.g. Acme Corp"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Preferred Org ID</Label>
              <Input
                placeholder="e.g. ACM1234"
                value={preferredOrgId}
                onChange={(e) =>
                  setPreferredOrgId(e.target.value.toUpperCase())
                }
                maxLength={7}
                className="font-mono"
              />
              {suggestedOrgId && (
                <p className="text-xs text-muted-foreground">
                  Suggested:{" "}
                  <button
                    className="font-mono font-semibold text-foreground hover:underline"
                    onClick={() => setPreferredOrgId(suggestedOrgId)}
                  >
                    {suggestedOrgId}
                  </button>
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>
              Your UID in this Org <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="e.g. EMP001"
              value={callerUid}
              onChange={(e) => setCallerUid(e.target.value.toUpperCase())}
              className="font-mono max-w-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              Your Mobile or Email <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="e.g. 9876543210 or you@example.com"
              value={callerIdentifier}
              onChange={(e) => setCallerIdentifier(e.target.value)}
              className="max-w-sm"
            />
          </div>
          <Separator />
          <div>
            <Label className="mb-3 block">
              Initial Participants{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Tabs
              value={memberTab}
              onValueChange={(v) => setMemberTab(v as any)}
            >
              <TabsList className="mb-3">
                <TabsTrigger value="table">Table</TabsTrigger>
                <TabsTrigger value="csv">CSV Import</TabsTrigger>
              </TabsList>
              <TabsContent value="table">
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>UID</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tableRows.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Input
                              placeholder="EMP002"
                              value={row.uid}
                              onChange={(e) =>
                                updateRow(
                                  i,
                                  "uid",
                                  e.target.value.toUpperCase(),
                                )
                              }
                              className="h-8 font-mono"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              placeholder="email or mobile"
                              value={row.contact}
                              onChange={(e) =>
                                updateRow(i, "contact", e.target.value)
                              }
                              className="h-8"
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={row.role}
                              onValueChange={(v) => updateRow(i, "role", v)}
                            >
                              <SelectTrigger className="h-8 w-28">
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
                              onClick={() => removeRow(i)}
                              disabled={tableRows.length === 1}
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
                  onClick={addRow}
                  className="mt-2"
                >
                  + Add Row
                </Button>
              </TabsContent>
              <TabsContent value="csv">
                <Textarea
                  placeholder={`uid,contact,role\nEMP002,alice@corp.com,v`}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  rows={8}
                  className="font-mono text-sm"
                />
              </TabsContent>
            </Tabs>
          </div>
        </div>
        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Registering…" : "Register Organization"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0">
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
              <div className="border rounded-md overflow-hidden">
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

                      // FIX: fragments in a .map() must have an explicit key.
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
      <DialogContent className="max-w-md">
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
    <div className="flex items-center gap-3 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg flex-wrap">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-semibold text-primary tabular-nums">
          {selectedCount}
        </span>
        <span className="text-sm text-muted-foreground">
          of {totalCount} selected
        </span>
      </div>
      <Separator orientation="vertical" className="h-4" />
      <button
        className="text-xs text-primary hover:underline font-medium whitespace-nowrap"
        onClick={allSelected ? onClearSelection : onSelectAll}
      >
        {allSelected ? "Clear all" : `Select all ${totalCount}`}
      </button>
      <div className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          onClick={onBulkMove}
        >
          <ArrowLeftRight className="w-3.5 h-3.5" /> Move
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          onClick={onBulkEdit}
        >
          <Pencil className="w-3.5 h-3.5" /> Edit roles
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
          onClick={onBulkRemove}
        >
          <Trash2 className="w-3.5 h-3.5" /> Remove
        </Button>
        <button
          className="text-muted-foreground hover:text-foreground ml-1"
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
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">
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
                <div className="border rounded-md overflow-hidden">
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
                  className="w-56 flex-shrink-0"
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
                  <SelectTrigger className="w-36 h-8 text-sm">
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

              <div className="border rounded-md overflow-hidden">
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

        <div className="px-6 py-4 border-t flex items-center justify-between gap-3">
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
function ManageOrgPanel({ org }: { org: OrgSummary }) {
  const [activeTab, setActiveTab] = useState("members");
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<
    "all" | "organizer" | "organizer-only" | "voter" | "voter-only" | "none"
  >("all");
  const [scopeFilter, setScopeFilter] = useState<string>("all");
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
      // FIX: api.getMembers now returns OrgMemberWithRoles[] directly — no cast needed.
      setMembers(await api.getMembers(org.orgid, org.uid, {}));
    } catch (e: any) {
      toast.error(e.message ?? "Failed to load members");
    } finally {
      setMembersLoading(false);
    }
  }, [org.orgid, org.uid]);

  // FIX: selectedScope was used inside fetchScopes but missing from its deps array,
  // causing a stale closure where the scope panel wouldn't re-highlight after a refresh.
  // Using a functional setter avoids capturing the stale value at all.
  const fetchScopes = useCallback(async () => {
    setScopeLoading(true);
    try {
      const data = (await api.getScopeTree(org.orgid, org.uid)) as ScopeNode[];
      setScopeTree(data);
      const flat = flattenTree(data);
      setFlatScopes(flat);
      // FIX: use functional update so we always compare against the latest selectedScope,
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

  // FIX: added fetchScopes to the dependency array. The previous deps [activeTab] was
  // incomplete — ESLint exhaustive-deps would flag this. flatScopes.length is no longer
  // needed as a dep because fetchScopes is now stable (memoized by useCallback).
  useEffect(() => {
    if (activeTab === "members") fetchScopes();
  }, [activeTab, fetchScopes]);

  useEffect(() => {
    setSelectedUids(new Set());
  }, [searchQuery, roleFilter, scopeFilter]);

  // ── Filtering ─────────────────────────────────────────────────────────────────
  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return members.filter((m) => {
      const contact = (m.email ?? m.mobile ?? "").toLowerCase();
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

  // ── Selection ─────────────────────────────────────────────────────────────────
  const selectableUids = filteredMembers
    .map((m) => m.uid)
    .filter((uid) => uid !== org.uid);
  const allFilteredSelected =
    selectableUids.length > 0 &&
    selectableUids.every((uid) => selectedUids.has(uid));
  const someSelected = selectableUids.some((uid) => selectedUids.has(uid));
  const selectedInView = filteredMembers.filter((m) =>
    selectedUids.has(m.uid),
  ).length;

  const toggleSelect = (uid: string) =>
    setSelectedUids((prev) => {
      const n = new Set(prev);
      n.has(uid) ? n.delete(uid) : n.add(uid);
      return n;
    });
  const selectAllFiltered = () => setSelectedUids(new Set(selectableUids));
  const clearSelection = () => setSelectedUids(new Set());
  const handleHeaderCheckbox = () => {
    if (allFilteredSelected)
      setSelectedUids((prev) => {
        const n = new Set(prev);
        selectableUids.forEach((uid) => n.delete(uid));
        return n;
      });
    else selectAllFiltered();
  };

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
    searchQuery.trim() || roleFilter !== "all" || scopeFilter !== "all";

  // ── Roles summary cell ────────────────────────────────────────────────────────
  const RolesSummary = ({ roles }: { roles: MemberRole[] }) => {
    if (!roles.length)
      return (
        <span className="text-xs text-muted-foreground italic">
          No assignments
        </span>
      );
    const show = roles.slice(0, 2);
    const rest = roles.length - 2;
    return (
      <div className="flex flex-wrap gap-1">
        {show.map((r) => {
          const name =
            flatScopes.find((s) => s.scope_id === r.scope_id)?.scope_name ??
            `S${r.scope_id}`;
          const label = roleLabel(r);
          return (
            <span
              key={r.scope_id}
              className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md
                             bg-muted border border-border text-foreground leading-none whitespace-nowrap"
            >
              <span className="truncate max-w-[60px]">{name}</span>
              <span className="text-muted-foreground">·</span>
              <span
                className={
                  label === "V+O"
                    ? "text-primary"
                    : label === "O"
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-muted-foreground"
                }
              >
                {label}
              </span>
            </span>
          );
        })}
        {rest > 0 && (
          <span className="text-[11px] text-muted-foreground font-medium px-1 py-0.5">
            +{rest} more
          </span>
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold leading-tight">
            {org.org_name}
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">
              {org.orgid}
            </span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">
              Your UID:{" "}
              <span className="font-mono font-semibold text-foreground">
                {org.uid}
              </span>
            </span>
          </div>
        </div>
        <Badge
          variant={org.is_active ? "default" : "secondary"}
          className="flex-shrink-0 mt-0.5"
        >
          {org.is_active ? "Active" : "Inactive"}
        </Badge>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="scope">Scope Tree</TabsTrigger>
        </TabsList>

        {/* ── MEMBERS TAB ── */}
        <TabsContent value="members" className="space-y-3 mt-4">
          <div className="space-y-2">
            <div className="flex gap-2 flex-wrap items-center">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search UID, email or mobile…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-7 w-56"
                />
                {searchQuery && (
                  <button
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setSearchQuery("")}
                    title="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <Select
                value={roleFilter}
                onValueChange={(v) => setRoleFilter(v as any)}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  <SelectItem value="voter">Has Voter</SelectItem>
                  <SelectItem value="voter-only">Voter only</SelectItem>
                  <SelectItem value="organizer">Has Organizer</SelectItem>
                  <SelectItem value="organizer-only">Organizer only</SelectItem>
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
                className="w-44"
              />
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground h-9"
                  onClick={() => {
                    setSearchQuery("");
                    setRoleFilter("all");
                    setScopeFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              )}
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={fetchMembers}
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setAddMemberOpen(true)}
                >
                  <UserPlus className="w-3.5 h-3.5" /> Add Members
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2 px-0.5">
              <p className="text-xs text-muted-foreground">
                {filteredMembers.length === members.length
                  ? `${members.length} member${members.length !== 1 ? "s" : ""}`
                  : `${filteredMembers.length} of ${members.length} members`}
              </p>
              {hasActiveFilters && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                  Filtered
                </Badge>
              )}
            </div>
          </div>

          {selectedUids.size > 0 && (
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
          )}

          {membersLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Loading members…
            </div>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 pr-0">
                      <Checkbox
                        checked={allFilteredSelected}
                        ref={(el) => {
                          if (el)
                            (el as any).indeterminate =
                              someSelected && !allFilteredSelected;
                        }}
                        onCheckedChange={handleHeaderCheckbox}
                        disabled={selectableUids.length === 0}
                      />
                    </TableHead>
                    <TableHead>UID</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Scope Assignments</TableHead>
                    <TableHead className="w-28 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center text-muted-foreground py-10"
                      >
                        {hasActiveFilters ? (
                          <div className="space-y-1">
                            <p>No members match your filters.</p>
                            <button
                              className="text-xs text-primary hover:underline"
                              onClick={() => {
                                setSearchQuery("");
                                setRoleFilter("all");
                                setScopeFilter("all");
                              }}
                            >
                              Clear filters
                            </button>
                          </div>
                        ) : (
                          "No members found"
                        )}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredMembers.map((m) => {
                      const isSelected = selectedUids.has(m.uid);
                      const isSelf = m.uid === org.uid;
                      return (
                        <TableRow
                          key={m.uid}
                          className={`transition-colors ${isSelected ? "bg-primary/5" : ""} ${isSelf ? "opacity-75" : ""}`}
                          onClick={() => !isSelf && toggleSelect(m.uid)}
                          style={{ cursor: isSelf ? "default" : "pointer" }}
                        >
                          <TableCell
                            className="pr-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() =>
                                !isSelf && toggleSelect(m.uid)
                              }
                              disabled={isSelf}
                            />
                          </TableCell>
                          <TableCell className="font-mono font-semibold text-sm">
                            {m.uid}
                            {isSelf && (
                              <span className="ml-1.5 text-[10px] font-normal text-muted-foreground bg-muted px-1 rounded">
                                you
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {m.email ?? m.mobile ?? "—"}
                          </TableCell>
                          <TableCell>
                            <RolesSummary roles={m.roles} />
                          </TableCell>
                          <TableCell
                            className="text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex justify-end items-center gap-0.5">
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
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                onClick={() => setManagingMember(m)}
                                title="Manage assignments"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setRemovingUid(m.uid)}
                                disabled={isSelf}
                                title="Remove member"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {selectedUids.size > 0 && filteredMembers.length > 0 && (
            <p className="text-xs text-muted-foreground px-0.5">
              {selectedInView} row{selectedInView !== 1 ? "s" : ""} selected in
              current view
              {selectedUids.size !== selectedInView &&
                ` · ${selectedUids.size} total across all filters`}
            </p>
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
        <TabsContent value="scope" className="mt-4">
          {scopeLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Loading scope tree…
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm">Hierarchy</CardTitle>
                  <CardDescription className="text-xs">
                    Click a node to view or edit
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-2 pb-4">
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
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm">
                    {selectedScope ? "Scope Actions" : "Select a Scope"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
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
      </Tabs>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────
export function ManageOrganizationsView() {
  const { session } = useAppContext();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState<OrgSummary | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);

  const isUnified = session?.type === "UNIFIED";
  const isGov = session?.type === "GOV";
  const isOrg = session?.type === "ORG";

  const fetchOrgs = async () => {
    setLoading(true);
    try {
      const data = (await api.getMyOrgs()) as OrgSummary[];
      const filtered = isOrg
        ? data.filter((o) => o.orgid === session?.orgid)
        : data;
      setOrgs(filtered);
      setSelectedOrg((prev) => {
        if (isOrg) return filtered[0] ?? null;
        if (prev)
          return (
            filtered.find((o) => o.orgid === prev.orgid) ?? filtered[0] ?? null
          );
        return filtered[0] ?? null;
      });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to load organizations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isGov) {
      setLoading(false);
      return;
    }
    fetchOrgs();
  }, []);

  if (isGov) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight mb-1">
            Organizations
          </h1>
        </div>
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <p className="font-semibold">Not available</p>
            <p className="text-sm text-muted-foreground">
              Organization management requires a Unified or Organization
              session.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">
            Organizations
          </h1>
          <p className="text-sm text-muted-foreground">
            {isUnified
              ? "Organizations where you hold an Organizer role"
              : `Managing ${selectedOrg?.org_name ?? "your organization"}`}
          </p>
        </div>
        {isUnified && (
          <Button
            onClick={() => setRegisterOpen(true)}
            className="flex-shrink-0 gap-1.5"
          >
            <Plus className="w-4 h-4" /> Register Org
          </Button>
        )}
      </div>

      {loading ? (
        <div className="py-16 text-center text-muted-foreground text-sm">
          Loading organizations…
        </div>
      ) : orgs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            {isUnified ? (
              <>
                <p className="text-muted-foreground">
                  You don't have any organizations yet.
                </p>
                <Button onClick={() => setRegisterOpen(true)}>
                  Register your first organization
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
      ) : isOrg ? (
        <Card>
          <CardContent className="pt-5 pb-6 px-5">
            {selectedOrg && (
              <ManageOrgPanel key={selectedOrg.orgid} org={selectedOrg} />
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-1 space-y-1.5">
            {orgs.map((org) => (
              <button
                key={org.orgid}
                onClick={() => setSelectedOrg(org)}
                className={`w-full text-left px-3 py-2.5 rounded-md border transition-colors
                        ${selectedOrg?.orgid === org.orgid ? "bg-accent border-primary/40 font-semibold" : "border-border hover:bg-accent/50"}`}
              >
                <p className="text-sm font-semibold truncate leading-tight">
                  {org.org_name}
                </p>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                  {org.orgid}
                </p>
                {!org.is_active && (
                  <Badge variant="secondary" className="text-[10px] mt-1 h-4">
                    Inactive
                  </Badge>
                )}
              </button>
            ))}
          </div>
          <div className="md:col-span-3">
            {selectedOrg ? (
              <Card>
                <CardContent className="pt-5 pb-6 px-5">
                  <ManageOrgPanel key={selectedOrg.orgid} org={selectedOrg} />
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-16 text-center text-sm text-muted-foreground">
                  Select an organization to manage
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {isUnified && (
        <RegisterOrgModal
          open={registerOpen}
          onClose={() => setRegisterOpen(false)}
          onSuccess={fetchOrgs}
        />
      )}
    </div>
  );
}
