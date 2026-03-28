import { useState, useEffect, useRef } from 'react';
import { api } from '../../lib/api';
import { useAppContext } from '../context/app-context';
import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrgSummary {
  orgid: string;
  org_name: string;
  is_active: boolean;
  uid: string; // caller's uid in this org
  scope_id: number;
}

interface OrgMember {
  uid: string;
  mobile: string | null;
  email: string | null;
  pid: string | null;
  is_deleted: boolean;
  member_roles?: {
    is_voter: boolean;
    is_organizer: boolean;
    scope_id: number;
  };
}

interface ScopeNode {
  scope_id: number;
  scope_name: string;
  orgid: string;
  parent_scope_id: number | null;
  children?: ScopeNode[];
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const vals = line.split(',').map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = vals[i] ?? ''));
    return row;
  });
}

function generateOrgId(name: string): string {
  const prefix = name
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, 'X');
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `${prefix}${digits}`;
}

// ─── Scope Tree helpers ───────────────────────────────────────────────────────

function buildTree(nodes: ScopeNode[]): ScopeNode[] {
  const map = new Map<number, ScopeNode>();
  nodes.forEach((n) => map.set(n.scope_id, { ...n, children: [] }));
  const roots: ScopeNode[] = [];
  map.forEach((node) => {
    if (node.parent_scope_id == null) {
      roots.push(node);
    } else {
      const parent = map.get(node.parent_scope_id);
      if (parent) parent.children!.push(node);
    }
  });
  return roots;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScopeTreeNode({
  node,
  depth = 0,
  selectedId,
  onSelect,
}: {
  node: ScopeNode;
  depth?: number;
  selectedId: number | null;
  onSelect: (n: ScopeNode) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ paddingLeft: depth * 20 }}>
      <div
        className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-accent transition-colors ${
          selectedId === node.scope_id ? 'bg-accent font-semibold' : ''
        }`}
        onClick={() => onSelect(node)}
      >
        {node.children && node.children.length > 0 && (
          <button
            className="text-muted-foreground text-xs w-4"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            {open ? '▼' : '▶'}
          </button>
        )}
        {(!node.children || node.children.length === 0) && (
          <span className="w-4 inline-block" />
        )}
        <span className="text-sm">{node.scope_name}</span>
        <span className="text-xs text-muted-foreground ml-auto">#{node.scope_id}</span>
      </div>
      {open &&
        node.children?.map((child) => (
          <ScopeTreeNode
            key={child.scope_id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

// ─── Register Org Modal ───────────────────────────────────────────────────────

function RegisterOrgModal({
  open,
  onClose,
  onSuccess,
  callerUid,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  callerUid?: string;
}) {
  const [orgName, setOrgName] = useState('');
  const [preferredOrgId, setPreferredOrgId] = useState('');
  const [myUid, setMyUid] = useState(callerUid ?? '');
  const [memberTab, setMemberTab] = useState<'table' | 'csv'>('table');
  const [csvText, setCsvText] = useState('');
  const [tableRows, setTableRows] = useState([
    { uid: '', email: '', mobile: '' },
  ]);
  const [loading, setLoading] = useState(false);

  const generatedOrgId = preferredOrgId.trim() || generateOrgId(orgName);

  const addTableRow = () =>
    setTableRows((r) => [...r, { uid: '', email: '', mobile: '' }]);

  const updateTableRow = (
    idx: number,
    field: 'uid' | 'email' | 'mobile',
    val: string,
  ) =>
    setTableRows((rows) =>
      rows.map((r, i) => (i === idx ? { ...r, [field]: val } : r)),
    );

  const buildMembers = () => {
    if (memberTab === 'csv') {
      return parseCsv(csvText).map((row) => ({
        uid: row.uid ?? row.UID ?? '',
        email: row.email ?? row.Email ?? null,
        mobile: row.mobile ?? row.Mobile ?? null,
      }));
    }
    return tableRows.filter((r) => r.uid.trim()).map((r) => ({
      uid: r.uid.trim(),
      email: r.email.trim() || null,
      mobile: r.mobile.trim() || null,
    }));
  };

  const handleSubmit = async () => {
    if (!orgName.trim()) return toast.error('Organization name is required');
    if (!myUid.trim()) return toast.error('Your UID is required');

    setLoading(true);
    try {
      await api.registerOrg({
        org_name: orgName.trim(),
        preferred_orgid: preferredOrgId.trim() || undefined,
        caller_uid: myUid.trim(),
        members: buildMembers(),
      });
      toast.success('Organization registered!');
      onSuccess();
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to register org');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register Organization</DialogTitle>
          <DialogDescription>
            Fill in the details. You'll be assigned Voter + Organizer role at ROOT scope.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Organization Name *</Label>
              <Input
                placeholder="Acme Corp"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Preferred Org ID (3 letters + 4 digits)</Label>
              <Input
                placeholder={`Auto: ${generateOrgId(orgName || 'ORG')}`}
                value={preferredOrgId}
                onChange={(e) => setPreferredOrgId(e.target.value.toUpperCase())}
                maxLength={7}
              />
              <p className="text-xs text-muted-foreground">
                Will use: <span className="font-mono font-bold">{generatedOrgId}</span>
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Your UID in this Org *</Label>
            <Input
              placeholder="e.g. EMP001"
              value={myUid}
              onChange={(e) => setMyUid(e.target.value.toUpperCase())}
            />
          </div>

          <Separator />

          <div>
            <Label className="mb-2 block">Participant List</Label>
            <Tabs value={memberTab} onValueChange={(v) => setMemberTab(v as any)}>
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
                        <TableHead>Email</TableHead>
                        <TableHead>Mobile</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tableRows.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Input
                              placeholder="UID"
                              value={row.uid}
                              onChange={(e) =>
                                updateTableRow(i, 'uid', e.target.value.toUpperCase())
                              }
                              className="h-8"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              placeholder="email"
                              value={row.email}
                              onChange={(e) => updateTableRow(i, 'email', e.target.value)}
                              className="h-8"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              placeholder="mobile"
                              value={row.mobile}
                              onChange={(e) => updateTableRow(i, 'mobile', e.target.value)}
                              className="h-8"
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <Button variant="outline" size="sm" onClick={addTableRow} className="mt-2">
                  + Add Row
                </Button>
              </TabsContent>

              <TabsContent value="csv">
                <Textarea
                  placeholder={`uid,email,mobile\nEMP001,alice@corp.com,9876543210\nEMP002,,9000000001`}
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  rows={8}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  CSV format: uid, email (optional), mobile (optional). Header row required.
                </p>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? 'Registering…' : 'Register Organization'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Manage Org Panel ─────────────────────────────────────────────────────────

function ManageOrgPanel({ org }: { org: OrgSummary }) {
  const [activeTab, setActiveTab] = useState('members');

  // Members state
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'voter' | 'organizer'>('all');

  // Add members modal
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addTab, setAddTab] = useState<'table' | 'csv'>('table');
  const [addCsv, setAddCsv] = useState('');
  const [addRows, setAddRows] = useState([{ uid: '', email: '', mobile: '' }]);
  const [addLoading, setAddLoading] = useState(false);

  // Scope state
  const [scopeTree, setScopeTree] = useState<ScopeNode[]>([]);
  const [flatScopes, setFlatScopes] = useState<ScopeNode[]>([]);
  const [selectedScope, setSelectedScope] = useState<ScopeNode | null>(null);
  const [scopeLoading, setScopeLoading] = useState(false);

  const fetchMembers = async () => {
    setMembersLoading(true);
    try {
      const data: OrgMember[] = await api.getMembers(org.orgid) as OrgMember[];
      setMembers(data);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load members');
    } finally {
      setMembersLoading(false);
    }
  };

  const fetchScopes = async () => {
    setScopeLoading(true);
    try {
      const data: ScopeNode[] = await api.getScopeTree(org.orgid, org.uid) as ScopeNode[];
      setFlatScopes(data);
      setScopeTree(buildTree(data));
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load scope tree');
    } finally {
      setScopeLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'members') fetchMembers();
    if (activeTab === 'scope') fetchScopes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, org.orgid]);

  // Filtered members
  const filteredMembers = members.filter((m) => {
    const matchSearch =
      !memberSearch ||
      m.uid.toLowerCase().includes(memberSearch.toLowerCase()) ||
      (m.email ?? '').toLowerCase().includes(memberSearch.toLowerCase()) ||
      (m.mobile ?? '').includes(memberSearch);

    const matchRole =
      roleFilter === 'all' ||
      (roleFilter === 'voter' && m.member_roles?.is_voter) ||
      (roleFilter === 'organizer' && m.member_roles?.is_organizer);

    return matchSearch && matchRole && !m.is_deleted;
  });

  // Add members submit
  const handleAddMembers = async () => {
    const buildRows = () => {
      if (addTab === 'csv') {
        return parseCsv(addCsv).map((r) => ({
          uid: r.uid ?? '',
          email: r.email || null,
          mobile: r.mobile || null,
        }));
      }
      return addRows.filter((r) => r.uid.trim()).map((r) => ({
        uid: r.uid.trim(),
        email: r.email.trim() || null,
        mobile: r.mobile.trim() || null,
      }));
    };

    setAddLoading(true);
    try {
      await api.addMembers(org.orgid, { members: buildRows() });
      toast.success('Members added');
      setAddMemberOpen(false);
      fetchMembers();
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to add members');
    } finally {
      setAddLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{org.org_name}</h2>
          <p className="text-sm text-muted-foreground font-mono">
            {org.orgid} · Your UID: <span className="font-bold">{org.uid}</span>
          </p>
        </div>
        <Badge variant={org.is_active ? 'default' : 'secondary'}>
          {org.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="scope">Scope Tree</TabsTrigger>
        </TabsList>

        {/* ── MEMBERS TAB ── */}
        <TabsContent value="members" className="space-y-3 mt-3">
          <div className="flex gap-2 flex-wrap">
            <Input
              placeholder="Search by UID, email or mobile…"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as any)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="voter">Voters</SelectItem>
                <SelectItem value="organizer">Organizers</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddMemberOpen(true)}
              className="ml-auto"
            >
              + Add Members
            </Button>
          </div>

          {membersLoading ? (
            <p className="text-sm text-muted-foreground py-4">Loading members…</p>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>UID</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Mobile</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead>Scope</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                        No members found
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredMembers.map((m) => (
                    <TableRow key={m.uid}>
                      <TableCell className="font-mono font-semibold">{m.uid}</TableCell>
                      <TableCell className="text-sm">{m.email ?? '—'}</TableCell>
                      <TableCell className="text-sm">{m.mobile ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {m.member_roles?.is_voter && (
                            <Badge variant="outline" className="text-xs">Voter</Badge>
                          )}
                          {m.member_roles?.is_organizer && (
                            <Badge className="text-xs">Organizer</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {m.member_roles?.scope_id != null
                          ? flatScopes.find((s) => s.scope_id === m.member_roles!.scope_id)
                              ?.scope_name ?? `#${m.member_roles.scope_id}`
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Add members dialog */}
          <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add Members to {org.org_name}</DialogTitle>
              </DialogHeader>
              <Tabs value={addTab} onValueChange={(v) => setAddTab(v as any)}>
                <TabsList>
                  <TabsTrigger value="table">Table</TabsTrigger>
                  <TabsTrigger value="csv">CSV</TabsTrigger>
                </TabsList>
                <TabsContent value="table" className="mt-3">
                  <div className="border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>UID</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Mobile</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {addRows.map((row, i) => (
                          <TableRow key={i}>
                            <TableCell>
                              <Input
                                placeholder="UID"
                                value={row.uid}
                                onChange={(e) =>
                                  setAddRows((rs) =>
                                    rs.map((r, j) =>
                                      j === i ? { ...r, uid: e.target.value.toUpperCase() } : r,
                                    ),
                                  )
                                }
                                className="h-8"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                placeholder="email"
                                value={row.email}
                                onChange={(e) =>
                                  setAddRows((rs) =>
                                    rs.map((r, j) =>
                                      j === i ? { ...r, email: e.target.value } : r,
                                    ),
                                  )
                                }
                                className="h-8"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                placeholder="mobile"
                                value={row.mobile}
                                onChange={(e) =>
                                  setAddRows((rs) =>
                                    rs.map((r, j) =>
                                      j === i ? { ...r, mobile: e.target.value } : r,
                                    ),
                                  )
                                }
                                className="h-8"
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() =>
                      setAddRows((r) => [...r, { uid: '', email: '', mobile: '' }])
                    }
                  >
                    + Add Row
                  </Button>
                </TabsContent>
                <TabsContent value="csv" className="mt-3">
                  <Textarea
                    placeholder={`uid,email,mobile\nEMP010,bob@org.com,9000000002`}
                    value={addCsv}
                    onChange={(e) => setAddCsv(e.target.value)}
                    rows={8}
                    className="font-mono text-sm"
                  />
                </TabsContent>
              </Tabs>
              <DialogFooter className="mt-4">
                <Button variant="outline" onClick={() => setAddMemberOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddMembers} disabled={addLoading}>
                  {addLoading ? 'Adding…' : 'Add Members'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* ── SCOPE TAB ── */}
        <TabsContent value="scope" className="mt-3">
          {scopeLoading ? (
            <p className="text-sm text-muted-foreground py-4">Loading scope tree…</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Tree view */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Scope Hierarchy</CardTitle>
                  <CardDescription className="text-xs">
                    Click a node to select it
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {scopeTree.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No scopes found</p>
                  ) : (
                    scopeTree.map((root) => (
                      <ScopeTreeNode
                        key={root.scope_id}
                        node={root}
                        selectedId={selectedScope?.scope_id ?? null}
                        onSelect={setSelectedScope}
                      />
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Selected scope info */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    {selectedScope ? selectedScope.scope_name : 'Select a scope'}
                  </CardTitle>
                  {selectedScope && (
                    <CardDescription className="text-xs font-mono">
                      scope_id: {selectedScope.scope_id}
                      {selectedScope.parent_scope_id != null &&
                        ` · parent: ${selectedScope.parent_scope_id}`}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  {!selectedScope ? (
                    <p className="text-sm text-muted-foreground">
                      Select a node from the tree to see details and members in that scope.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                          Members in this scope
                        </p>
                        {members
                          .filter(
                            (m) =>
                              m.member_roles?.scope_id === selectedScope.scope_id &&
                              !m.is_deleted,
                          )
                          .map((m) => (
                            <div
                              key={m.uid}
                              className="flex items-center justify-between py-1 border-b last:border-0"
                            >
                              <span className="font-mono text-sm font-semibold">{m.uid}</span>
                              <div className="flex gap-1">
                                {m.member_roles?.is_voter && (
                                  <Badge variant="outline" className="text-xs">V</Badge>
                                )}
                                {m.member_roles?.is_organizer && (
                                  <Badge className="text-xs">O</Badge>
                                )}
                              </div>
                            </div>
                          ))}
                        {members.filter(
                          (m) =>
                            m.member_roles?.scope_id === selectedScope.scope_id && !m.is_deleted,
                        ).length === 0 && (
                          <p className="text-sm text-muted-foreground">
                            No members at this scope level
                          </p>
                        )}
                      </div>
                    </div>
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
  const { user } = useAppContext();
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrg, setSelectedOrg] = useState<OrgSummary | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);

  const fetchOrgs = async () => {
    setLoading(true);
    try {
      const data: OrgSummary[] = await api.getMyOrgs() as OrgSummary[];
      setOrgs(data);
      if (data.length > 0 && !selectedOrg) setSelectedOrg(data[0]);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrgs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="mb-1">Manage Organizations</h1>
          <p className="text-muted-foreground">
            Organizations where you have an Organizer role
          </p>
        </div>
        <Button onClick={() => setRegisterOpen(true)}>+ Register Org</Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : orgs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">
              You don't have any organizations yet.
            </p>
            <Button onClick={() => setRegisterOpen(true)}>Register your first organization</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Org list sidebar */}
          <div className="md:col-span-1 space-y-2">
            {orgs.map((org) => (
              <button
                key={org.orgid}
                onClick={() => setSelectedOrg(org)}
                className={`w-full text-left px-3 py-2 rounded-md border transition-colors hover:bg-accent ${
                  selectedOrg?.orgid === org.orgid
                    ? 'bg-accent border-primary font-semibold'
                    : 'border-border'
                }`}
              >
                <p className="text-sm font-semibold truncate">{org.org_name}</p>
                <p className="text-xs text-muted-foreground font-mono">{org.orgid}</p>
              </button>
            ))}
          </div>

          {/* Manage panel */}
          <div className="md:col-span-3">
            {selectedOrg ? (
              <Card>
                <CardContent className="pt-6">
                  <ManageOrgPanel org={selectedOrg} />
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Select an organization to manage
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      <RegisterOrgModal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onSuccess={fetchOrgs}
        callerUid={user?.pid?.toString()}
      />
    </div>
  );
}