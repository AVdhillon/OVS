import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Plus, Upload, Search, Loader2, Lock, Trash2, Pencil, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { toast } from 'sonner';
import { Tree, TreeNode } from 'react-organizational-chart';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip';

// ─── Backend types ────────────────────────────────────────────────────────────

interface BackendOrg {
  orgid: string;
  org_name: string;
  org_email: string | null;
  is_active: boolean;
  created_at: string;
}

interface BackendMember {
  uid: string;
  mobile: string | null;
  email: string | null;
  pid: string | null;
  is_voter: boolean;
  is_organizer: boolean;
  scope_id: number | null;
}

interface BackendScopeNode {
  scope_id: number;
  scope_name: string;
  parent_scope_id: number | null;
  children: BackendScopeNode[];
}

// ─── API helper ───────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

function getToken(): string | null {
  return localStorage.getItem('access_token');
}

/** Decode the JWT payload without verifying the signature (client-side read). */
function getJwtPayload(): { type?: string; uid?: string; orgid?: string; pid?: string } | null {
  const token = getToken();
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
      ...(options.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message ?? `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ManageOrganizationsView() {
  // JWT payload (stable across renders)
  const jwtPayload = getJwtPayload();
  const sessionType = jwtPayload?.type ?? 'UNIFIED';
  const sessionUid = jwtPayload?.uid ?? '';

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'register' | 'manage'>('register');

  // ── Register org state ─────────────────────────────────────────────────────
  const [orgName, setOrgName] = useState('');
  const [orgEmail, setOrgEmail] = useState('');
  const [orgPrefix, setOrgPrefix] = useState('');
  const [orgSuffix, setOrgSuffix] = useState('');
  const [callerUidInput, setCallerUidInput] = useState(''); // uid this user will have in the org
  const [importMethod, setImportMethod] = useState<'manual' | 'csv'>('manual');
  const [csvText, setCsvText] = useState('');
  const [manualParticipants, setManualParticipants] = useState<
    { uid: string; mobile: string; email: string; role: 'v' | 'vo' }[]
  >([{ uid: '', mobile: '', email: '', role: 'v' }]);
  const [registering, setRegistering] = useState(false);

  // ── Manage orgs state ──────────────────────────────────────────────────────
  const [myOrgs, setMyOrgs] = useState<BackendOrg[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  // For UNIFIED sessions: the caller's uid within the selected org
  const [callerUidByOrg, setCallerUidByOrg] = useState<Record<string, string>>({});
  const [uidPromptOrgId, setUidPromptOrgId] = useState<string | null>(null);
  const [uidPromptInput, setUidPromptInput] = useState('');

  // members
  const [members, setMembers] = useState<BackendMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterScopeId, setFilterScopeId] = useState('');

  // scope tree
  const [scopeTree, setScopeTree] = useState<BackendScopeNode[]>([]);
  const [scopeLoading, setScopeLoading] = useState(false);

  // add member dialog
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberUid, setNewMemberUid] = useState('');
  const [newMemberMobile, setNewMemberMobile] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'v' | 'vo'>('v');
  const [addingMember, setAddingMember] = useState(false);

  // edit member dialog
  const [editingMember, setEditingMember] = useState<BackendMember | null>(null);
  const [editVoter, setEditVoter] = useState(true);
  const [editOrganizer, setEditOrganizer] = useState(false);
  const [editScopeId, setEditScopeId] = useState<number | null>(null);
  const [savingMember, setSavingMember] = useState(false);

  // scope dialogs
  const [addingScopeParentId, setAddingScopeParentId] = useState<number | null>(null);
  const [newScopeName, setNewScopeName] = useState('');
  const [addingScopeLoading, setAddingScopeLoading] = useState(false);

  const [renamingScopeNode, setRenamingScopeNode] = useState<BackendScopeNode | null>(null);
  const [renameScopeText, setRenameScopeText] = useState('');
  const [renamingScopeLoading, setRenamingScopeLoading] = useState(false);

  // ── Derived caller uid ─────────────────────────────────────────────────────
  function callerUidFor(orgid: string): string {
    if (sessionType === 'ORG') return sessionUid;
    return callerUidByOrg[orgid] ?? '';
  }

  // ── Fetch my orgs ──────────────────────────────────────────────────────────
  const fetchMyOrgs = useCallback(async () => {
    setOrgsLoading(true);
    try {
      const data = await apiFetch<BackendOrg[]>('/org/mine');
      setMyOrgs(data);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load organizations');
    } finally {
      setOrgsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'manage') fetchMyOrgs();
  }, [activeTab, fetchMyOrgs]);

  // ── Fetch members ──────────────────────────────────────────────────────────
  const fetchMembers = useCallback(
    async (orgid: string, uid: string) => {
      if (!orgid || !uid) return;
      setMembersLoading(true);
      try {
        const params = new URLSearchParams();
        if (searchTerm) params.set('search', searchTerm);
        if (filterRole !== 'all') params.set('role', filterRole);
        if (filterScopeId) params.set('scope_id', filterScopeId);
        const query = params.toString() ? `?${params}` : '';
        const data = await apiFetch<BackendMember[]>(`/org/${orgid}/members${query}`, {}, {
          'x-caller-uid': uid,
        });
        setMembers(data);
      } catch (e: any) {
        toast.error(e.message ?? 'Failed to load members');
      } finally {
        setMembersLoading(false);
      }
    },
    [searchTerm, filterRole, filterScopeId],
  );

  // ── Fetch scope tree ───────────────────────────────────────────────────────
  const fetchScopeTree = useCallback(async (orgid: string, uid: string) => {
    if (!orgid || !uid) return;
    setScopeLoading(true);
    try {
      const data = await apiFetch<BackendScopeNode[]>(`/org/${orgid}/scope`, {}, {
        'x-caller-uid': uid,
      });
      setScopeTree(data);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load scope tree');
    } finally {
      setScopeLoading(false);
    }
  }, []);

  // ── When org or uid changes, reload data ───────────────────────────────────
  useEffect(() => {
    if (!selectedOrgId) return;
    const uid = callerUidFor(selectedOrgId);
    if (!uid) {
      // need to prompt for uid on UNIFIED sessions
      setUidPromptOrgId(selectedOrgId);
      return;
    }
    fetchMembers(selectedOrgId, uid);
    fetchScopeTree(selectedOrgId, uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrgId, callerUidByOrg]);

  // ── Re-fetch members when filters change ──────────────────────────────────
  useEffect(() => {
    if (!selectedOrgId) return;
    const uid = callerUidFor(selectedOrgId);
    if (!uid) return;
    fetchMembers(selectedOrgId, uid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, filterRole, filterScopeId]);

  // ─────────────────────────────────────────────────────────────────────────
  // REGISTER ORG
  // ─────────────────────────────────────────────────────────────────────────

  const handleAddParticipantRow = () => {
    setManualParticipants((prev) => [...prev, { uid: '', mobile: '', email: '', role: 'v' }]);
  };

  const handleParticipantChange = (
    index: number,
    field: keyof (typeof manualParticipants)[0],
    value: string,
  ) => {
    setManualParticipants((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleRegisterOrganization = async () => {
    if (!orgName.trim()) {
      toast.error('Organization name is required');
      return;
    }
    const callerUid = callerUidInput.trim().toUpperCase();
    if (!callerUid) {
      toast.error('Your UID for this organization is required');
      return;
    }
    if (!/^[A-Z0-9]{4,20}$/.test(callerUid)) {
      toast.error('Your UID must be 4–20 uppercase letters/digits');
      return;
    }
    if (orgPrefix && !/^[A-Z]{3}$/.test(orgPrefix)) {
      toast.error('Preferred prefix must be exactly 3 uppercase letters');
      return;
    }
    if (orgSuffix && !/^[0-9]{4}$/.test(orgSuffix)) {
      toast.error('Preferred suffix must be exactly 4 digits');
      return;
    }

    const participants =
      importMethod === 'manual'
        ? manualParticipants
            .filter((p) => p.uid.trim())
            .map((p) => ({
              uid: p.uid.trim().toUpperCase(),
              ...(p.mobile.trim() && { mobile: p.mobile.trim() }),
              ...(p.email.trim() && { email: p.email.trim() }),
              role: p.role,
            }))
        : undefined;

    const body: Record<string, unknown> = {
      org_name: orgName.trim(),
      caller_uid: callerUid,
      ...(orgEmail.trim() && { org_email: orgEmail.trim() }),
      ...(orgPrefix && { org_prefix: orgPrefix }),
      ...(orgSuffix && { org_suffix: orgSuffix }),
      ...(importMethod === 'manual' && participants && participants.length > 0 && { participants }),
      ...(importMethod === 'csv' && csvText.trim() && { participants_csv: csvText.trim() }),
    };

    setRegistering(true);
    try {
      const result = await apiFetch<{ orgid: string; org_name: string; message: string }>(
        '/org/register',
        { method: 'POST', body: JSON.stringify(body) },
      );

      toast.success(result.message ?? 'Organization registered!');

      // Remember this user's uid in the new org
      setCallerUidByOrg((prev) => ({ ...prev, [result.orgid]: callerUid }));

      // Reset form
      setOrgName('');
      setOrgEmail('');
      setOrgPrefix('');
      setOrgSuffix('');
      setCallerUidInput('');
      setCsvText('');
      setManualParticipants([{ uid: '', mobile: '', email: '', role: 'v' }]);

      // Switch to manage tab and reload
      setActiveTab('manage');
      await fetchMyOrgs();
      setSelectedOrgId(result.orgid);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to register organization');
    } finally {
      setRegistering(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // MEMBER OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  const handleAddMember = async () => {
    const uid = callerUidFor(selectedOrgId);
    if (!newMemberUid.trim()) { toast.error('UID is required'); return; }
    setAddingMember(true);
    try {
      await apiFetch(
        `/org/${selectedOrgId}/members`,
        {
          method: 'POST',
          body: JSON.stringify({
            participants: [
              {
                uid: newMemberUid.trim().toUpperCase(),
                ...(newMemberMobile.trim() && { mobile: newMemberMobile.trim() }),
                ...(newMemberEmail.trim() && { email: newMemberEmail.trim() }),
                role: newMemberRole,
              },
            ],
          }),
        },
        { 'x-caller-uid': uid },
      );
      toast.success('Member added');
      setShowAddMember(false);
      setNewMemberUid('');
      setNewMemberMobile('');
      setNewMemberEmail('');
      setNewMemberRole('v');
      await fetchMembers(selectedOrgId, uid);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to add member');
    } finally {
      setAddingMember(false);
    }
  };

  const openEditMember = (member: BackendMember) => {
    setEditingMember(member);
    setEditVoter(member.is_voter);
    setEditOrganizer(member.is_organizer);
    setEditScopeId(member.scope_id);
  };

  const handleSaveMember = async () => {
    if (!editingMember) return;
    const uid = callerUidFor(selectedOrgId);
    setSavingMember(true);
    try {
      await apiFetch(
        `/org/${selectedOrgId}/members/${editingMember.uid}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            is_voter: editVoter,
            is_organizer: editOrganizer,
            ...(editScopeId !== null && { scope_id: editScopeId }),
          }),
        },
        { 'x-caller-uid': uid },
      );
      toast.success('Member updated');
      setEditingMember(null);
      await fetchMembers(selectedOrgId, uid);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to update member');
    } finally {
      setSavingMember(false);
    }
  };

  const handleRemoveMember = async (targetUid: string) => {
    const uid = callerUidFor(selectedOrgId);
    try {
      await apiFetch(
        `/org/${selectedOrgId}/members/${targetUid}`,
        { method: 'DELETE' },
        { 'x-caller-uid': uid },
      );
      toast.success('Member removed');
      await fetchMembers(selectedOrgId, uid);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to remove member');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // SCOPE OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  const handleAddScope = async () => {
    const uid = callerUidFor(selectedOrgId);
    if (!newScopeName.trim()) { toast.error('Scope name is required'); return; }
    setAddingScopeLoading(true);
    try {
      await apiFetch(
        `/org/${selectedOrgId}/scope`,
        {
          method: 'POST',
          body: JSON.stringify({
            scope_name: newScopeName.trim(),
            ...(addingScopeParentId !== null && { parent_scope_id: addingScopeParentId }),
          }),
        },
        { 'x-caller-uid': uid },
      );
      toast.success('Scope node created');
      setAddingScopeParentId(null);
      setNewScopeName('');
      await fetchScopeTree(selectedOrgId, uid);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to create scope');
    } finally {
      setAddingScopeLoading(false);
    }
  };

  const handleRenameScope = async () => {
    if (!renamingScopeNode || !renameScopeText.trim()) return;
    const uid = callerUidFor(selectedOrgId);
    setRenamingScopeLoading(true);
    try {
      await apiFetch(
        `/org/${selectedOrgId}/scope/${renamingScopeNode.scope_id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ scope_name: renameScopeText.trim() }),
        },
        { 'x-caller-uid': uid },
      );
      toast.success('Scope renamed');
      setRenamingScopeNode(null);
      setRenameScopeText('');
      await fetchScopeTree(selectedOrgId, uid);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to rename scope');
    } finally {
      setRenamingScopeLoading(false);
    }
  };

  const handleDeleteScope = async (scopeId: number) => {
    const uid = callerUidFor(selectedOrgId);
    try {
      await apiFetch(
        `/org/${selectedOrgId}/scope/${scopeId}`,
        { method: 'DELETE' },
        { 'x-caller-uid': uid },
      );
      toast.success('Scope node deleted');
      await fetchScopeTree(selectedOrgId, uid);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to delete scope');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // SCOPE TREE RENDER
  // ─────────────────────────────────────────────────────────────────────────

  const renderScopeNode = (node: BackendScopeNode): React.ReactElement => {
    const isRoot = node.parent_scope_id === null;

    return (
      <TreeNode
        key={node.scope_id}
        label={
          <ContextMenu>
            <ContextMenuTrigger>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="px-3 py-2 border rounded-lg bg-white hover:bg-blue-50 cursor-pointer border-blue-200 inline-block min-w-[100px] text-center">
                      {isRoot && <Lock className="h-3 w-3 inline mr-1 text-muted-foreground" />}
                      <span className="text-sm font-medium">{node.scope_name}</span>
                      <div className="text-xs text-muted-foreground">id: {node.scope_id}</div>
                    </div>
                  </TooltipTrigger>
                  {isRoot && (
                    <TooltipContent>Root scope — cannot be renamed or deleted</TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onClick={() => {
                  setAddingScopeParentId(node.scope_id);
                  setNewScopeName('');
                }}
              >
                <Plus className="mr-2 h-4 w-4" /> Add child node
              </ContextMenuItem>
              {!isRoot && (
                <>
                  <ContextMenuItem
                    onClick={() => {
                      setRenamingScopeNode(node);
                      setRenameScopeText(node.scope_name);
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" /> Rename
                  </ContextMenuItem>
                  <ContextMenuItem
                    className="text-destructive"
                    onClick={() => handleDeleteScope(node.scope_id)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuContent>
          </ContextMenu>
        }
      >
        {node.children.map((child) => renderScopeNode(child))}
      </TreeNode>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  const selectedOrg = myOrgs.find((o) => o.orgid === selectedOrgId);

  // Collect all scope nodes flat for filter dropdown
  const flatScopes: BackendScopeNode[] = [];
  const flattenScopes = (nodes: BackendScopeNode[]) => {
    for (const n of nodes) {
      flatScopes.push(n);
      flattenScopes(n.children);
    }
  };
  flattenScopes(scopeTree);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="mb-2">Manage Organizations</h1>
        <p className="text-muted-foreground">Register new organizations or manage existing ones</p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList>
          <TabsTrigger value="register">Register New Organization</TabsTrigger>
          <TabsTrigger value="manage">Manage Existing Organizations</TabsTrigger>
        </TabsList>

        {/* ── Register Tab ── */}
        <TabsContent value="register" className="space-y-6 mt-6">
          {/* Org Details */}
          <Card>
            <CardHeader>
              <CardTitle>Organization Details</CardTitle>
              <CardDescription>Basic information about the organization</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>
                    Organization Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    placeholder="e.g., TechCorp Inc."
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Organization Email</Label>
                  <Input
                    placeholder="contact@org.com"
                    type="email"
                    value={orgEmail}
                    onChange={(e) => setOrgEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="space-y-2 col-span-1">
                  <Label>Preferred Prefix</Label>
                  <Input
                    placeholder="ABC"
                    maxLength={3}
                    value={orgPrefix}
                    onChange={(e) => setOrgPrefix(e.target.value.toUpperCase())}
                  />
                  <p className="text-xs text-muted-foreground">3 uppercase letters</p>
                </div>
                <div className="space-y-2 col-span-1">
                  <Label>Preferred Suffix</Label>
                  <Input
                    placeholder="1234"
                    maxLength={4}
                    value={orgSuffix}
                    onChange={(e) => setOrgSuffix(e.target.value.replace(/\D/g, ''))}
                  />
                  <p className="text-xs text-muted-foreground">4 digits</p>
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>
                    Your UID in this Org <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    placeholder="e.g., EMP001"
                    value={callerUidInput}
                    onChange={(e) => setCallerUidInput(e.target.value.toUpperCase())}
                  />
                  <p className="text-xs text-muted-foreground">
                    4–20 uppercase letters/digits. You'll be the root organizer.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Participants */}
          <Card>
            <CardHeader>
              <CardTitle>Participant Import</CardTitle>
              <CardDescription>Seed initial members (optional)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs value={importMethod} onValueChange={(v) => setImportMethod(v as any)}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="manual">Manual Entry</TabsTrigger>
                  <TabsTrigger value="csv">CSV Text</TabsTrigger>
                </TabsList>

                <TabsContent value="manual" className="mt-4 space-y-3">
                  <div className="grid grid-cols-4 gap-3 text-xs text-muted-foreground">
                    <div>UID *</div>
                    <div>Mobile</div>
                    <div>Email</div>
                    <div>Role</div>
                  </div>
                  {manualParticipants.map((p, idx) => (
                    <div key={idx} className="grid grid-cols-4 gap-3">
                      <Input
                        placeholder="UID"
                        value={p.uid}
                        onChange={(e) =>
                          handleParticipantChange(idx, 'uid', e.target.value.toUpperCase())
                        }
                      />
                      <Input
                        placeholder="Mobile"
                        value={p.mobile}
                        onChange={(e) => handleParticipantChange(idx, 'mobile', e.target.value)}
                      />
                      <Input
                        placeholder="Email"
                        type="email"
                        value={p.email}
                        onChange={(e) => handleParticipantChange(idx, 'email', e.target.value)}
                      />
                      <Select
                        value={p.role}
                        onValueChange={(v) => handleParticipantChange(idx, 'role', v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="v">Voter</SelectItem>
                          <SelectItem value="vo">Voter + Organizer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                  <Button variant="outline" onClick={handleAddParticipantRow} className="w-full">
                    <Plus className="mr-2 h-4 w-4" /> Add Row
                  </Button>
                </TabsContent>

                <TabsContent value="csv" className="mt-4 space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Paste CSV text. Header row:{' '}
                    <code className="bg-muted px-1 rounded text-xs">uid,mobile,email,role</code>.
                    Role defaults to <code className="bg-muted px-1 rounded text-xs">v</code> if
                    omitted.
                  </p>
                  <textarea
                    className="w-full min-h-[140px] rounded-md border bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder={`uid,mobile,email,role\nEMP001,9876543210,emp@org.com,v\nMGR001,,,vo`}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleRegisterOrganization} size="lg" disabled={registering}>
              {registering && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Register Organization
            </Button>
          </div>
        </TabsContent>

        {/* ── Manage Tab ── */}
        <TabsContent value="manage" className="mt-6">
          {orgsLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : myOrgs.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No organizations found. Register your first organization to get started.
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="mb-6">
                <Label htmlFor="selectOrg">Select Organization</Label>
                <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                  <SelectTrigger id="selectOrg" className="mt-1">
                    <SelectValue placeholder="Choose an organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {myOrgs.map((org) => (
                      <SelectItem key={org.orgid} value={org.orgid}>
                        {org.org_name} — {org.orgid}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedOrg && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Members Pane */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Participant Management</CardTitle>
                      <CardDescription>Members within your scope in {selectedOrg.org_name}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Filters */}
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search by UID, email or mobile…"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-9"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Select value={filterRole} onValueChange={setFilterRole}>
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Filter by Role" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Roles</SelectItem>
                            <SelectItem value="organizer">Organizer</SelectItem>
                            <SelectItem value="voter">Voter</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={filterScopeId}
                          onValueChange={setFilterScopeId}
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Filter by Scope" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">All Scopes</SelectItem>
                            {flatScopes.map((s) => (
                              <SelectItem key={s.scope_id} value={String(s.scope_id)}>
                                {s.scope_name} (id {s.scope_id})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Members table */}
                      <div className="border rounded-lg overflow-hidden">
                        {membersLoading ? (
                          <div className="flex justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                          </div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>UID</TableHead>
                                <TableHead>Contact</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Scope</TableHead>
                                <TableHead className="w-16"></TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {members.length > 0 ? (
                                members.map((m) => (
                                  <TableRow key={m.uid}>
                                    <TableCell className="font-mono text-sm">{m.uid}</TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                      {m.email ?? m.mobile ?? '—'}
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex gap-1 flex-wrap">
                                        {m.is_organizer && (
                                          <Badge variant="default">Organizer</Badge>
                                        )}
                                        {m.is_voter && (
                                          <Badge variant="secondary">Voter</Badge>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-sm">{m.scope_id ?? '—'}</TableCell>
                                    <TableCell>
                                      <div className="flex gap-1">
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7"
                                          onClick={() => openEditMember(m)}
                                        >
                                          <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 text-destructive hover:text-destructive"
                                          onClick={() => handleRemoveMember(m.uid)}
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ))
                              ) : (
                                <TableRow>
                                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                                    No members found
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        )}
                      </div>

                      <Button
                        variant="outline"
                        onClick={() => setShowAddMember(true)}
                        className="w-full"
                      >
                        <Plus className="mr-2 h-4 w-4" /> Add Member
                      </Button>
                    </CardContent>
                  </Card>

                  {/* Scope Tree Pane */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Organizational Hierarchy</CardTitle>
                      <CardDescription>Right-click any node to add child, rename, or delete</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {scopeLoading ? (
                        <div className="flex justify-center py-16">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        <div className="border rounded-lg p-4 bg-gray-50 overflow-x-auto min-h-[200px]">
                          {scopeTree.length > 0 ? (
                            scopeTree.map((rootNode) => (
                              <Tree
                                key={rootNode.scope_id}
                                lineWidth="2px"
                                lineColor="#cbd5e1"
                                lineBorderRadius="10px"
                                label={
                                  <ContextMenu>
                                    <ContextMenuTrigger>
                                      <div className="px-3 py-2 border-2 border-blue-700 rounded-lg bg-blue-50 inline-block min-w-[100px] text-center">
                                        <Lock className="h-3 w-3 inline mr-1 text-blue-700" />
                                        <span className="text-sm font-medium">{rootNode.scope_name}</span>
                                        <div className="text-xs text-muted-foreground">ROOT</div>
                                      </div>
                                    </ContextMenuTrigger>
                                    <ContextMenuContent>
                                      <ContextMenuItem
                                        onClick={() => {
                                          setAddingScopeParentId(rootNode.scope_id);
                                          setNewScopeName('');
                                        }}
                                      >
                                        <Plus className="mr-2 h-4 w-4" /> Add child node
                                      </ContextMenuItem>
                                    </ContextMenuContent>
                                  </ContextMenu>
                                }
                              >
                                {rootNode.children.map((child) => renderScopeNode(child))}
                              </Tree>
                            ))
                          ) : (
                            <div className="text-center py-8 text-muted-foreground">
                              <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                              <p className="mb-4 text-sm">No scope data returned</p>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* ── UID Prompt (UNIFIED session, org selected for first time) ── */}
      <Dialog
        open={!!uidPromptOrgId}
        onOpenChange={() => { setUidPromptOrgId(null); setUidPromptInput(''); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter your UID for this organization</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Your session is a unified account. Enter the member UID you registered under in{' '}
            <strong>{uidPromptOrgId}</strong>.
          </p>
          <div className="space-y-4 mt-2">
            <Input
              placeholder="e.g., EMP001"
              value={uidPromptInput}
              onChange={(e) => setUidPromptInput(e.target.value.toUpperCase())}
            />
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => { setUidPromptOrgId(null); setUidPromptInput(''); }}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  if (!uidPromptInput.trim()) return;
                  const orgid = uidPromptOrgId!;
                  setCallerUidByOrg((prev) => ({ ...prev, [orgid]: uidPromptInput.trim() }));
                  setUidPromptOrgId(null);
                  setUidPromptInput('');
                }}
              >
                Confirm
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add Member Dialog ── */}
      <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1">
              <Label>UID <span className="text-destructive">*</span></Label>
              <Input
                placeholder="4–20 uppercase alphanumeric"
                value={newMemberUid}
                onChange={(e) => setNewMemberUid(e.target.value.toUpperCase())}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Mobile</Label>
                <Input
                  placeholder="10 digits"
                  value={newMemberMobile}
                  onChange={(e) => setNewMemberMobile(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input
                  placeholder="email@example.com"
                  type="email"
                  value={newMemberEmail}
                  onChange={(e) => setNewMemberEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={newMemberRole} onValueChange={(v) => setNewMemberRole(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="v">Voter</SelectItem>
                  <SelectItem value="vo">Voter + Organizer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowAddMember(false)}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={handleAddMember} disabled={addingMember}>
                {addingMember && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Member
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit Member Dialog ── */}
      <Dialog open={!!editingMember} onOpenChange={() => setEditingMember(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Member — {editingMember?.uid}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={editVoter}
                  onChange={(e) => setEditVoter(e.target.checked)}
                  className="rounded"
                />
                Voter
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={editOrganizer}
                  onChange={(e) => setEditOrganizer(e.target.checked)}
                  className="rounded"
                />
                Organizer
              </label>
            </div>
            <div className="space-y-1">
              <Label>Assign Scope</Label>
              <Select
                value={editScopeId !== null ? String(editScopeId) : ''}
                onValueChange={(v) => setEditScopeId(v ? Number(v) : null)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Keep current" />
                </SelectTrigger>
                <SelectContent>
                  {flatScopes.map((s) => (
                    <SelectItem key={s.scope_id} value={String(s.scope_id)}>
                      {s.scope_name} (id {s.scope_id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setEditingMember(null)}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={handleSaveMember} disabled={savingMember}>
                {savingMember && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add Scope Dialog ── */}
      <Dialog
        open={addingScopeParentId !== null}
        onOpenChange={() => { setAddingScopeParentId(null); setNewScopeName(''); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Child Scope Node</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>Scope Name</Label>
              <Input
                placeholder="e.g., Engineering, North Zone"
                value={newScopeName}
                onChange={(e) => setNewScopeName(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setAddingScopeParentId(null); setNewScopeName(''); }}
              >
                Cancel
              </Button>
              <Button className="flex-1" onClick={handleAddScope} disabled={addingScopeLoading}>
                {addingScopeLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Rename Scope Dialog ── */}
      <Dialog
        open={!!renamingScopeNode}
        onOpenChange={() => { setRenamingScopeNode(null); setRenameScopeText(''); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Scope Node</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>New Name</Label>
              <Input
                value={renameScopeText}
                onChange={(e) => setRenameScopeText(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setRenamingScopeNode(null); setRenameScopeText(''); }}
              >
                Cancel
              </Button>
              <Button className="flex-1" onClick={handleRenameScope} disabled={renamingScopeLoading}>
                {renamingScopeLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}