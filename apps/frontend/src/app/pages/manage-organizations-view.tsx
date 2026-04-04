import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../../lib/api';
import { useAppContext } from '../context/app-context';
import type { OrgSummary, OrgMember, ScopeNode } from '../context/app-context';
import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split('\n').filter(Boolean);
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
  const prefix = name.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3).padEnd(3, 'X');
  return `${prefix}${Math.floor(1000 + Math.random() * 9000)}`;
}

// ─── Scope helpers ────────────────────────────────────────────────────────────

function flattenTree(nodes: ScopeNode[]): ScopeNode[] {
  const result: ScopeNode[] = [];
  const walk = (list: ScopeNode[]) => list.forEach((n) => { result.push(n); if (n.children?.length) walk(n.children); });
  walk(nodes);
  return result;
}

// ─── ScopeTreeSelect ──────────────────────────────────────────────────────────

function ScopeTreeSelectNode({
                               node, depth, value, onSelect,
                             }: {
  node: ScopeNode; depth: number; value: string; onSelect: (v: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isSelected = value === String(node.scope_id);

  return (
      <div>
        <div
            className={`flex items-center gap-1 py-1.5 rounded-md cursor-pointer text-sm select-none transition-colors
          ${isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-foreground'}`}
            style={{ paddingLeft: `${depth * 14 + 6}px`, paddingRight: 6 }}
            onClick={() => onSelect(String(node.scope_id))}
        >
          {hasChildren ? (
              <button
                  className={`flex-shrink-0 w-4 h-4 flex items-center justify-center text-[10px] transition-transform
              ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={(e) => { e.stopPropagation(); setExpanded((o) => !o); }}
              >
                <span className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}>▶</span>
              </button>
          ) : <span className="w-4 flex-shrink-0" />}
          <span className="truncate flex-1">{node.scope_name}</span>
        </div>
        {expanded && hasChildren && node.children.map((child) => (
            <ScopeTreeSelectNode key={child.scope_id} node={child} depth={depth + 1} value={value} onSelect={onSelect} />
        ))}
      </div>
  );
}

function ScopeTreeSelect({
                           scopeTree, flatScopes, value, onChange,
                           placeholder = 'Select scope',
                           allowAll = false,
                           allowKeep = false,
                           className = '',
                         }: {
  scopeTree: ScopeNode[]; flatScopes: ScopeNode[];
  value: string; onChange: (val: string) => void;
  placeholder?: string; allowAll?: boolean; allowKeep?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);

  const displayName =
      value === 'all'  ? 'All scopes' :
          value === 'keep' ? 'Keep current scope' :
              flatScopes.find((s) => String(s.scope_id) === value)?.scope_name ?? placeholder;

  const isDefault = !value || value === 'all' || value === 'keep';
  const handleSelect = (val: string) => { onChange(val); setOpen(false); };

  return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open}
                  className={`justify-between font-normal ${className}`}>
            <span className={isDefault ? 'text-muted-foreground' : ''}>{displayName}</span>
            <span className={`ml-2 text-[10px] text-muted-foreground transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>▾</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-1 w-56" align="start" sideOffset={4}>
          <div className="max-h-64 overflow-y-auto">
            {allowAll && (
                <>
                  <div
                      className={`py-1.5 px-2.5 rounded-md cursor-pointer text-sm transition-colors
                  ${value === 'all' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                      onClick={() => handleSelect('all')}
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
                  ${value === 'keep' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                      onClick={() => handleSelect('keep')}
                  >
                    Keep current scope
                  </div>
                  <div className="my-1 border-t" />
                </>
            )}
            {scopeTree.length === 0
                ? <p className="text-xs text-muted-foreground px-2.5 py-2">No scopes available</p>
                : scopeTree.map((node) => (
                    <ScopeTreeSelectNode key={node.scope_id} node={node} depth={0} value={value} onSelect={handleSelect} />
                ))
            }
          </div>
        </PopoverContent>
      </Popover>
  );
}

// ─── ScopeTreeNode (scope management sidebar) ─────────────────────────────────

function ScopeTreeNode({ node, depth, selectedId, onSelect }: {
  node: ScopeNode; depth: number; selectedId: number | null; onSelect: (n: ScopeNode) => void;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedId === node.scope_id;

  return (
      <div>
        <div
            className={`group flex items-center gap-1.5 py-1.5 px-2 rounded-md cursor-pointer transition-colors text-sm
          ${isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent text-foreground'}`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => onSelect(node)}
        >
          {hasChildren ? (
              <button
                  className={`flex-shrink-0 w-4 h-4 flex items-center justify-center rounded text-xs transition-transform
              ${isSelected ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
              >
                <span className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>▶</span>
              </button>
          ) : <span className="w-4 flex-shrink-0" />}
          <span className="flex-1 truncate font-medium">{node.scope_name}</span>
        </div>
        {open && hasChildren && (
            <div>
              {node.children.map((child) => (
                  <ScopeTreeNode key={child.scope_id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
              ))}
            </div>
        )}
      </div>
  );
}

// ─── Register Org Modal ───────────────────────────────────────────────────────

function RegisterOrgModal({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [orgName, setOrgName] = useState('');
  const [preferredOrgId, setPreferredOrgId] = useState('');
  const [callerUid, setCallerUid] = useState('');
  const [callerIdentifier, setCallerIdentifier] = useState('');
  const [memberTab, setMemberTab] = useState<'table' | 'csv'>('table');
  const [csvText, setCsvText] = useState('');
  const [tableRows, setTableRows] = useState([{ uid: '', contact: '', role: 'v' as 'v' | 'vo' }]);
  const [loading, setLoading] = useState(false);

  const suggestedOrgId = preferredOrgId.trim() || (orgName ? generateOrgId(orgName) : '');
  const addRow = () => setTableRows((r) => [...r, { uid: '', contact: '', role: 'v' }]);
  const updateRow = (idx: number, field: keyof (typeof tableRows)[0], val: string) =>
      setTableRows((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: val } : r)));
  const removeRow = (idx: number) => setTableRows((rows) => rows.filter((_, i) => i !== idx));

  const buildParticipants = () => memberTab === 'csv'
      ? parseCsv(csvText).filter((r) => (r.uid ?? '').trim()).map((r) => ({
        uid: (r.uid ?? '').trim().toUpperCase(),
        participant_identifier: (r.contact ?? r.email ?? r.mobile ?? '').trim() || undefined,
        role: (r.role as 'v' | 'vo') || 'v',
      }))
      : tableRows.filter((r) => r.uid.trim()).map((r) => ({
        uid: r.uid.trim().toUpperCase(),
        participant_identifier: r.contact.trim() || undefined,
        role: r.role,
      }));

  const handleSubmit = async () => {
    if (!orgName.trim()) return toast.error('Organization name is required');
    if (!callerUid.trim()) return toast.error('Your UID in this org is required');
    if (!callerIdentifier.trim()) return toast.error('Your mobile or email is required');
    setLoading(true);
    try {
      const result = await api.registerOrg({
        org_name: orgName.trim(),
        preferred_orgid: preferredOrgId.trim() || undefined,
        caller_uid: callerUid.trim().toUpperCase(),
        caller_identifier: callerIdentifier.trim(),
        participants: buildParticipants(),
      });
      toast.success(`Organization "${result.org_name}" registered as ${result.orgid}`);
      onSuccess(); onClose();
      setOrgName(''); setPreferredOrgId(''); setCallerUid(''); setCallerIdentifier('');
      setTableRows([{ uid: '', contact: '', role: 'v' }]); setCsvText('');
    } catch (e: any) { toast.error(e.message ?? 'Failed to register organization'); }
    finally { setLoading(false); }
  };

  return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Register New Organization</DialogTitle>
            <DialogDescription>You will be assigned Voter + Organizer roles at the ROOT scope automatically.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Organization Name <span className="text-destructive">*</span></Label>
                <Input placeholder="e.g. Acme Corp" value={orgName} onChange={(e) => setOrgName(e.target.value)} autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label>Preferred Org ID</Label>
                <Input placeholder="e.g. ACM1234" value={preferredOrgId}
                       onChange={(e) => setPreferredOrgId(e.target.value.toUpperCase())} maxLength={7} className="font-mono" />
                {suggestedOrgId && (
                    <p className="text-xs text-muted-foreground">
                      Suggested: <button className="font-mono font-semibold text-foreground hover:underline"
                                         onClick={() => setPreferredOrgId(suggestedOrgId)}>{suggestedOrgId}</button>
                    </p>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Your UID in this Org <span className="text-destructive">*</span></Label>
              <Input placeholder="e.g. EMP001" value={callerUid}
                     onChange={(e) => setCallerUid(e.target.value.toUpperCase())} className="font-mono max-w-sm" />
            </div>
            <div className="space-y-1.5">
              <Label>Your Mobile or Email <span className="text-destructive">*</span></Label>
              <Input placeholder="e.g. 9876543210 or you@example.com" value={callerIdentifier}
                     onChange={(e) => setCallerIdentifier(e.target.value)} className="max-w-sm" />
            </div>
            <Separator />
            <div>
              <Label className="mb-3 block">Initial Participants <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Tabs value={memberTab} onValueChange={(v) => setMemberTab(v as any)}>
                <TabsList className="mb-3"><TabsTrigger value="table">Table</TabsTrigger><TabsTrigger value="csv">CSV Import</TabsTrigger></TabsList>
                <TabsContent value="table">
                  <div className="border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader><TableRow><TableHead>UID</TableHead><TableHead>Contact</TableHead><TableHead>Role</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
                      <TableBody>
                        {tableRows.map((row, i) => (
                            <TableRow key={i}>
                              <TableCell><Input placeholder="EMP002" value={row.uid} onChange={(e) => updateRow(i, 'uid', e.target.value.toUpperCase())} className="h-8 font-mono" /></TableCell>
                              <TableCell><Input placeholder="email or mobile" value={row.contact} onChange={(e) => updateRow(i, 'contact', e.target.value)} className="h-8" /></TableCell>
                              <TableCell>
                                <Select value={row.role} onValueChange={(v) => updateRow(i, 'role', v)}>
                                  <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="v">Voter only</SelectItem>
                                    <SelectItem value="o">Organizer only</SelectItem>
                                    <SelectItem value="vo">Both</SelectItem>
                                    <SelectItem value="none">None</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell><Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                                 onClick={() => removeRow(i)} disabled={tableRows.length === 1}>✕</Button></TableCell>
                            </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <Button variant="outline" size="sm" onClick={addRow} className="mt-2">+ Add Row</Button>
                </TabsContent>
                <TabsContent value="csv">
                  <Textarea placeholder={`uid,contact,role\nEMP002,alice@corp.com,v`} value={csvText}
                            onChange={(e) => setCsvText(e.target.value)} rows={8} className="font-mono text-sm" />
                </TabsContent>
              </Tabs>
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={loading}>{loading ? 'Registering…' : 'Register Organization'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}

// ─── Edit Member Dialog ───────────────────────────────────────────────────────

function EditMemberDialog({ open, member, org, scopeTree, flatScopes, onClose, onSuccess }: {
  open: boolean; member: OrgMember | null; org: OrgSummary;
  scopeTree: ScopeNode[]; flatScopes: ScopeNode[];
  onClose: () => void; onSuccess: () => void;
}) {
  const [isVoter, setIsVoter] = useState(false);
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [scopeId, setScopeId] = useState<string>('keep');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (member) {
      setIsVoter(member.is_voter);
      setIsOrganizer(member.is_organizer);
      setScopeId(member.scope_id != null ? String(member.scope_id) : 'keep');
    }
  }, [member]);

  const handleSave = async () => {
    if (!member) return;
    setLoading(true);
    try {
      await api.updateMember(org.orgid, org.uid, member.uid, {
        is_voter: isVoter,
        is_organizer: isOrganizer,
        scope_id: scopeId !== 'keep' ? Number(scopeId) : undefined,
      });
      toast.success(`Updated ${member.uid}`);
      onSuccess(); onClose();
    } catch (e: any) { toast.error(e.message ?? 'Failed to update member'); }
    finally { setLoading(false); }
  };

  return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Member</DialogTitle>
            <DialogDescription className="font-mono">{member?.uid}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-3">
              <Label>Roles</Label>
              <div className="flex items-center gap-2">
                <Checkbox id="is_voter" checked={isVoter} onCheckedChange={(v) => setIsVoter(Boolean(v))} />
                <label htmlFor="is_voter" className="text-sm cursor-pointer">Voter</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="is_organizer" checked={isOrganizer} onCheckedChange={(v) => setIsOrganizer(Boolean(v))} />
                <label htmlFor="is_organizer" className="text-sm cursor-pointer">Organizer</label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <ScopeTreeSelect
                  scopeTree={scopeTree} flatScopes={flatScopes}
                  value={scopeId} onChange={setScopeId}
                  allowKeep placeholder="Select scope" className="w-full"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button onClick={handleSave} disabled={loading}>{loading ? 'Saving…' : 'Save Changes'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}

// ─── Bulk Edit Dialog ─────────────────────────────────────────────────────────

function BulkEditDialog({ open, selectedUids, org, scopeTree, flatScopes, onClose, onSuccess }: {
  open: boolean; selectedUids: string[]; org: OrgSummary;
  scopeTree: ScopeNode[]; flatScopes: ScopeNode[];
  onClose: () => void; onSuccess: () => void;
}) {
  const [voterChange, setVoterChange] = useState<'yes' | 'no' | 'keep'>('keep');
  const [organizerChange, setOrganizerChange] = useState<'yes' | 'no' | 'keep'>('keep');
  const [scopeId, setScopeId] = useState<string>('keep');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (open) { setVoterChange('keep'); setOrganizerChange('keep'); setScopeId('keep'); setProgress(0); }
  }, [open]);

  const hasChanges = voterChange !== 'keep' || organizerChange !== 'keep' || scopeId !== 'keep';
  const selectedScopeName = flatScopes.find((s) => String(s.scope_id) === scopeId)?.scope_name;

  const handleApply = async () => {
    if (!hasChanges) return toast.error('No changes selected');
    setLoading(true); setProgress(0);
    let successCount = 0;
    const errors: string[] = [];
    for (let i = 0; i < selectedUids.length; i++) {
      try {
        const payload: Record<string, any> = {};
        if (voterChange !== 'keep') payload.is_voter = voterChange === 'yes';
        if (organizerChange !== 'keep') payload.is_organizer = organizerChange === 'yes';
        if (scopeId !== 'keep') payload.scope_id = Number(scopeId);
        await api.updateMember(org.orgid, org.uid, selectedUids[i], payload);
        successCount++;
      } catch (e: any) { errors.push(`${selectedUids[i]}: ${e.message ?? 'error'}`); }
      setProgress(Math.round(((i + 1) / selectedUids.length) * 100));
    }
    if (successCount > 0) toast.success(`Updated ${successCount} member${successCount !== 1 ? 's' : ''}`);
    errors.forEach((e) => toast.error(e));
    setLoading(false); onSuccess(); onClose();
  };

  const TriToggle = ({ label, value, onChange }: { label: string; value: 'keep' | 'yes' | 'no'; onChange: (v: 'keep' | 'yes' | 'no') => void }) => (
      <div className="space-y-2">
        <Label className="text-sm font-medium">{label}</Label>
        <div className="flex gap-2">
          {(['keep', 'yes', 'no'] as const).map((v) => (
              <button key={v} onClick={() => onChange(v)}
                      className={`flex-1 py-1.5 px-3 rounded-md border text-sm font-medium transition-colors
              ${value === v
                          ? v === 'no' ? 'bg-destructive/10 border-destructive/40 text-destructive'
                              : v === 'yes' ? 'bg-primary/10 border-primary/40 text-primary'
                                  : 'bg-accent border-border text-foreground'
                          : 'border-border text-muted-foreground hover:bg-accent/50'}`}>
                {v === 'keep' ? 'Keep' : v === 'yes' ? '✓ Enable' : '✕ Disable'}
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
              Applying changes to <span className="font-semibold text-foreground">{selectedUids.length}</span> member{selectedUids.length !== 1 ? 's' : ''}.{' '}
              Fields set to <span className="font-mono text-xs bg-muted px-1 rounded">Keep</span> will not be changed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <TriToggle label="Voter Role" value={voterChange} onChange={setVoterChange} />
            <TriToggle label="Organizer Role" value={organizerChange} onChange={setOrganizerChange} />
            <div className="space-y-2">
              <Label className="text-sm font-medium">Scope</Label>
              <ScopeTreeSelect scopeTree={scopeTree} flatScopes={flatScopes}
                               value={scopeId} onChange={setScopeId}
                               allowKeep placeholder="Select scope" className="w-full" />
            </div>
            {hasChanges && (
                <div className="rounded-md border bg-muted/40 px-3 py-2.5 space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Changes to apply</p>
                  {voterChange !== 'keep' && (
                      <p className="text-sm">Voter → <span className={`font-semibold ${voterChange === 'yes' ? 'text-primary' : 'text-destructive'}`}>{voterChange === 'yes' ? 'Enabled' : 'Disabled'}</span></p>
                  )}
                  {organizerChange !== 'keep' && (
                      <p className="text-sm">Organizer → <span className={`font-semibold ${organizerChange === 'yes' ? 'text-primary' : 'text-destructive'}`}>{organizerChange === 'yes' ? 'Enabled' : 'Disabled'}</span></p>
                  )}
                  {scopeId !== 'keep' && (
                      <p className="text-sm">Scope → <span className="font-semibold">{selectedScopeName}</span></p>
                  )}
                </div>
            )}
            {loading && (
                <div className="space-y-1.5">
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground text-center">{progress}% — updating members…</p>
                </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button onClick={handleApply} disabled={loading || !hasChanges}>
              {loading ? 'Applying…' : `Apply to ${selectedUids.length} member${selectedUids.length !== 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}

// ─── Bulk Action Bar ──────────────────────────────────────────────────────────

function BulkActionBar({ selectedCount, totalCount, onSelectAll, onClearSelection, onBulkEdit, onBulkRemove }: {
  selectedCount: number; totalCount: number;
  onSelectAll: () => void; onClearSelection: () => void;
  onBulkEdit: () => void; onBulkRemove: () => void;
}) {
  const allSelected = selectedCount === totalCount && totalCount > 0;
  return (
      <div className="flex items-center gap-3 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-primary tabular-nums">{selectedCount}</span>
          <span className="text-sm text-muted-foreground">of {totalCount} selected</span>
        </div>
        <Separator orientation="vertical" className="h-4" />
        <button className="text-xs text-primary hover:underline font-medium whitespace-nowrap"
                onClick={allSelected ? onClearSelection : onSelectAll}>
          {allSelected ? 'Clear all' : `Select all ${totalCount}`}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onBulkEdit}>✏ Edit selected</Button>
          <Button size="sm" variant="outline"
                  className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
                  onClick={onBulkRemove}>✕ Remove selected</Button>
          <button className="text-xs text-muted-foreground hover:text-foreground ml-1" onClick={onClearSelection}>✕</button>
        </div>
      </div>
  );
}

// ─── Scope Actions Panel ──────────────────────────────────────────────────────

function ScopeActionsPanel({ node, org, flatScopes, onRefresh }: { node: ScopeNode; org: OrgSummary; flatScopes: ScopeNode[]; onRefresh: () => void }){
  const isRoot = node.parent_scope_id === null;
  const hasChildren = node.children && node.children.length > 0;

  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(node.scope_name);
  const [renameLoading, setRenameLoading] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [childName, setChildName] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => { setNewName(node.scope_name); setRenaming(false); setAddingChild(false); setChildName(''); }, [node.scope_id]);

  const handleRename = async () => {
    if (!newName.trim() || newName.trim() === node.scope_name) { setRenaming(false); return; }
    setRenameLoading(true);
    try { await api.updateScope(org.orgid, org.uid, node.scope_id, { scope_name: newName.trim() }); toast.success('Scope renamed'); onRefresh(); setRenaming(false); }
    catch (e: any) { toast.error(e.message ?? 'Failed to rename scope'); }
    finally { setRenameLoading(false); }
  };

  const handleAddChild = async () => {
    if (!childName.trim()) return;
    setAddLoading(true);
    try { await api.createScope(org.orgid, org.uid, { scope_name: childName.trim(), parent_scope_id: node.scope_id }); toast.success(`Scope "${childName.trim()}" created`); onRefresh(); setAddingChild(false); setChildName(''); }
    catch (e: any) { toast.error(e.message ?? 'Failed to create scope'); }
    finally { setAddLoading(false); }
  };

  const handleDelete = async () => {
    setDeleteLoading(true);
    try { await api.deleteScope(org.orgid, org.uid, node.scope_id); toast.success('Scope deleted'); onRefresh(); setDeleteOpen(false); }
    catch (e: any) {
      const msg =
          e?.cause?.originalMessage ??   // raw Prisma path (if ever surfaced)
          e?.message ??
          'Failed to delete scope';
      toast.error(msg);
    }
    finally { setDeleteLoading(false); }
  };

  return (
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-base font-semibold">{node.scope_name}</p>
            {isRoot && <Badge variant="secondary" className="text-xs">ROOT</Badge>}
          </div>
          <p className="text-xs font-mono text-muted-foreground">
            {node.parent_scope_id != null && (
                <>Parent: <span className="font-medium text-foreground">{flatScopes.find(s => s.scope_id === node.parent_scope_id)?.scope_name ?? '—'}</span></>
            )}
          </p>
        </div>
        <Separator />
        {!isRoot && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rename</p>
              {renaming ? (
                  <div className="flex gap-2">
                    <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="h-8 text-sm" autoFocus
                           onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') { setRenaming(false); setNewName(node.scope_name); } }} />
                    <Button size="sm" className="h-8" onClick={handleRename} disabled={renameLoading}>{renameLoading ? '…' : 'Save'}</Button>
                    <Button size="sm" variant="outline" className="h-8" onClick={() => { setRenaming(false); setNewName(node.scope_name); }}>Cancel</Button>
                  </div>
              ) : <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>Rename scope</Button>}
            </div>
        )}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add Child Scope</p>
          {addingChild ? (
              <div className="flex gap-2">
                <Input placeholder="Scope name" value={childName} onChange={(e) => setChildName(e.target.value)} className="h-8 text-sm" autoFocus
                       onKeyDown={(e) => { if (e.key === 'Enter') handleAddChild(); if (e.key === 'Escape') { setAddingChild(false); setChildName(''); } }} />
                <Button size="sm" className="h-8" onClick={handleAddChild} disabled={addLoading}>{addLoading ? '…' : 'Create'}</Button>
                <Button size="sm" variant="outline" className="h-8" onClick={() => { setAddingChild(false); setChildName(''); }}>Cancel</Button>
              </div>
          ) : <Button variant="outline" size="sm" onClick={() => setAddingChild(true)}>+ Add child scope</Button>}
        </div>
        {!isRoot && !hasChildren && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Danger Zone</p>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive border-destructive/30 hover:bg-destructive/5"
                      onClick={() => setDeleteOpen(true)}>Delete this scope</Button>
              <p className="text-xs text-muted-foreground">Only leaf nodes with no members or active events can be deleted.</p>
            </div>
        )}
        {hasChildren && !isRoot && <p className="text-xs text-muted-foreground italic">Remove all child scopes before deleting this node.</p>}
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{node.scope_name}"?</AlertDialogTitle>
              <AlertDialogDescription>This scope will be permanently removed. This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} disabled={deleteLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {deleteLoading ? 'Deleting…' : 'Delete Scope'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
  );
}

// ─── Add Members Dialog ───────────────────────────────────────────────────────
// 2-step wizard:
//   Step 1 "input"  — Table entry OR CSV paste → Parse
//   Step 2 "review" — Editable table with per-row scope, bulk scope assign, filter/search

type AddMemberRow = {
  id: string;          // stable local key — never sent to API
  uid: string;
  contact: string;
  role: 'v' | 'o' | 'vo' | 'none';
  scopeId: string;     // '' = use default scope
};

function makeRow(uid = '', contact = '', role: 'v' | 'o' | 'vo' | 'none' = 'v', scopeId = ''): AddMemberRow {
  return { id: Math.random().toString(36).slice(2, 9), uid, contact, role, scopeId };
}

// Compact inline scope picker used inside the review table rows
function RowScopePicker({
                          rowId, scopeId, defaultScopeId, scopeTree, flatScopes, onChange,
                        }: {
  rowId: string; scopeId: string; defaultScopeId: string;
  scopeTree: ScopeNode[]; flatScopes: ScopeNode[];
  onChange: (id: string, val: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const hasOverride = !!scopeId;
  const label = hasOverride
      ? (flatScopes.find(s => String(s.scope_id) === scopeId)?.scope_name ?? 'Unknown')
      : defaultScopeId
          ? (flatScopes.find(s => String(s.scope_id) === defaultScopeId)?.scope_name ?? 'Default')
          : 'Org root';

  return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
              className={`group flex items-center gap-1.5 text-xs rounded-md border px-2 py-1.5 transition-colors
            hover:bg-accent max-w-[180px] w-full text-left
            ${hasOverride
                  ? 'border-primary/40 text-primary bg-primary/5 font-medium'
                  : 'border-border text-muted-foreground'
              }`}
          >
            {hasOverride && (
                <span
                    className="flex-shrink-0 hover:text-destructive transition-colors leading-none"
                    onClick={(e) => { e.stopPropagation(); onChange(rowId, ''); setOpen(false); }}
                    title="Clear override"
                >✕</span>
            )}
            <span className="truncate flex-1">{label}</span>
            {!hasOverride && <span className="flex-shrink-0 opacity-40 text-[10px]">▾</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-1 w-56" align="start" sideOffset={4}>
          <div className="max-h-60 overflow-y-auto">
            <div
                className={`py-1.5 px-2.5 rounded-md cursor-pointer text-sm transition-colors
              ${!scopeId ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                onClick={() => { onChange(rowId, ''); setOpen(false); }}
            >
              <span className="font-medium">Use default scope</span>
              {defaultScopeId && (
                  <span className="ml-1.5 text-[11px] opacity-70">
                ({flatScopes.find(s => String(s.scope_id) === defaultScopeId)?.scope_name ?? '…'})
              </span>
              )}
            </div>
            <div className="my-1 border-t" />
            {scopeTree.length === 0
                ? <p className="text-xs text-muted-foreground px-2.5 py-2">No scopes available</p>
                : scopeTree.map(node => (
                    <ScopeTreeSelectNode key={node.scope_id} node={node} depth={0}
                                         value={scopeId}
                                         onSelect={(v) => { onChange(rowId, v); setOpen(false); }}
                    />
                ))
            }
          </div>
        </PopoverContent>
      </Popover>
  );
}

function AddMembersDialog({ open, org, scopeTree, flatScopes, onClose, onSuccess }: {
  open: boolean; org: OrgSummary;
  scopeTree: ScopeNode[]; flatScopes: ScopeNode[];
  onClose: () => void; onSuccess: () => void;
}) {
  const [step, setStep] = useState<'input' | 'review'>('input');
  const [inputTab, setInputTab] = useState<'table' | 'csv'>('table');
  const [csvText, setCsvText] = useState('');
  const [csvError, setCsvError] = useState('');

  // Shared row state (used in both steps)
  const [rows, setRows] = useState<AddMemberRow[]>([makeRow()]);

  // Review step state
  const [defaultScopeId, setDefaultScopeId] = useState<string>('');
  const [reviewSearch, setReviewSearch] = useState('');
  const [reviewRoleFilter, setReviewRoleFilter] = useState<'all' | 'v' | 'o' | 'vo' | 'none'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkScopeId, setBulkScopeId] = useState<string>('');
  const [loading, setLoading] = useState(false);

  // Reset everything when dialog opens/closes
  useEffect(() => {
    if (open) {
      setStep('input');
      setInputTab('table');
      setCsvText('');
      setCsvError('');
      setRows([makeRow()]);
      setDefaultScopeId('');
      setReviewSearch('');
      setReviewRoleFilter('all');
      setSelectedIds(new Set());
      setBulkScopeId('');
    }
  }, [open]);

  // Clear selection when filter changes in review
  useEffect(() => { setSelectedIds(new Set()); }, [reviewSearch, reviewRoleFilter]);

  // ── Row helpers ──────────────────────────────────────────────────────────

  const updateRow = (id: string, field: keyof Omit<AddMemberRow, 'id'>, val: string) =>
      setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: val } : r));

  const removeRow = (id: string) => {
    setRows(prev => prev.filter(r => r.id !== id));
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  // ── Input step ───────────────────────────────────────────────────────────

  const parseCsvToReview = () => {
    const parsed = parseCsv(csvText);
    if (parsed.length === 0) {
      setCsvError('No valid rows found. Check that your CSV has a header row: uid,contact,role');
      return;
    }
    const newRows = parsed
        .filter(r => (r.uid ?? '').trim())
        .map(r => makeRow(
            (r.uid ?? '').trim().toUpperCase(),
            (r.contact ?? r.email ?? r.mobile ?? '').trim(),
            ((['v', 'o', 'vo', 'none'].includes((r.role ?? '').trim().toLowerCase())
                ? (r.role ?? '').trim().toLowerCase()
                : 'v') as 'v' | 'o' | 'vo' | 'none'),
        ));
    if (!newRows.length) { setCsvError('No rows with a UID found in the CSV'); return; }
    setCsvError('');
    setRows(newRows);
    setStep('review');
  };

  const goToReview = () => {
    const valid = rows.filter(r => r.uid.trim());
    if (!valid.length) { toast.error('Add at least one member with a UID'); return; }
    setRows(valid);
    setStep('review');
  };

  // ── Review step filtering ────────────────────────────────────────────────

  const filteredRows = useMemo(() => {
    const q = reviewSearch.trim().toLowerCase();
    return rows.filter(r => {
      if (q && !r.uid.toLowerCase().includes(q) && !r.contact.toLowerCase().includes(q)) return false;
      if (reviewRoleFilter !== 'all' && r.role !== reviewRoleFilter) return false;
      return true;
    });
  }, [rows, reviewSearch, reviewRoleFilter]);

  const allFilteredSelected = filteredRows.length > 0 && filteredRows.every(r => selectedIds.has(r.id));
  const someFilteredSelected = filteredRows.some(r => selectedIds.has(r.id));

  const toggleSelect = (id: string) =>
      setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectAllFiltered = () =>
      setSelectedIds(prev => { const n = new Set(prev); filteredRows.forEach(r => n.add(r.id)); return n; });

  const clearSelection = () => setSelectedIds(new Set());

  const handleHeaderCheckbox = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => { const n = new Set(prev); filteredRows.forEach(r => n.delete(r.id)); return n; });
    } else selectAllFiltered();
  };

  // ── Bulk scope assign (review) ───────────────────────────────────────────

  const applyBulkScope = () => {
    setRows(prev => prev.map(r => selectedIds.has(r.id) ? { ...r, scopeId: bulkScopeId } : r));
    setSelectedIds(new Set());
    setBulkScopeId('');
  };

  // ── Submit ───────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    const valid = rows.filter(r => r.uid.trim());
    if (!valid.length) return toast.error('No members to add');

    // Group by effective scope so members with different scopes are submitted in separate batches
    const groups = new Map<string, AddMemberRow[]>();
    for (const row of valid) {
      const key = row.scopeId || defaultScopeId || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    setLoading(true);
    let totalAdded = 0, totalSkipped = 0;
    try {
      for (const [scopeKey, scopeRows] of groups) {
        const body: Parameters<typeof api.addMembers>[2] = {
          participants: scopeRows.map(r => ({
            uid: r.uid,
            participant_identifier: r.contact || undefined,
            role: r.role as 'v' | 'vo' | 'o' | 'none',
          })),
        };
        if (scopeKey) body.scope_id = Number(scopeKey)
        const res = await api.addMembers(org.orgid, org.uid, body);
        totalAdded += res.results.filter(r => r.status === 'added' || r.status === 'reactivated').length;
        totalSkipped += res.results.filter(r => r.status === 'skipped').length;
        res.results.filter(r => r.status === 'error').forEach(e => toast.error(`${e.uid}: ${e.error ?? 'error'}`));
      }
      toast.success(`${totalAdded} added${totalSkipped ? `, ${totalSkipped} skipped` : ''}`);
      onSuccess();
      onClose();
    } catch (e: any) { toast.error(e.message ?? 'Failed to add members'); }
    finally { setLoading(false); }
  };

  const validCount = rows.filter(r => r.uid.trim()).length;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">

          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b">
            <DialogTitle className="text-base font-semibold">Add Members to {org.org_name}</DialogTitle>

            {/* Step breadcrumb */}
            <div className="flex items-center gap-1.5 mt-3">
              <div className={`flex items-center gap-1.5 text-xs font-medium transition-colors
              ${step === 'input' ? 'text-foreground' : 'text-muted-foreground'}`}>
              <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold
                ${step === 'input' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                1
              </span>
                Enter members
              </div>
              <span className="text-muted-foreground text-xs">──</span>
              <div className={`flex items-center gap-1.5 text-xs font-medium transition-colors
              ${step === 'review' ? 'text-foreground' : 'text-muted-foreground'}`}>
              <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold
                ${step === 'review' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                2
              </span>
                Review & assign scopes
              </div>
            </div>
          </div>

          {/* Body — scrollable */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0">

            {/* ── STEP 1: INPUT ── */}
            {step === 'input' && (
                <Tabs value={inputTab} onValueChange={(v) => setInputTab(v as any)}>
                  <TabsList>
                    <TabsTrigger value="table">Manual entry</TabsTrigger>
                    <TabsTrigger value="csv">CSV import</TabsTrigger>
                  </TabsList>

                  {/* Table input */}
                  <TabsContent value="table" className="mt-4 space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Enter members below. You'll assign scopes on the next screen.
                    </p>
                    <div className="border rounded-md overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>UID <span className="text-destructive">*</span></TableHead>
                            <TableHead>Contact <span className="text-muted-foreground font-normal">(email or mobile)</span></TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead className="w-10" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((row) => (
                              <TableRow key={row.id}>
                                <TableCell>
                                  <Input placeholder="EMP010" value={row.uid}
                                         onChange={(e) => updateRow(row.id, 'uid', e.target.value.toUpperCase())}
                                         className="h-8 font-mono" />
                                </TableCell>
                                <TableCell>
                                  <Input placeholder="alice@corp.com or 9876543210" value={row.contact}
                                         onChange={(e) => updateRow(row.id, 'contact', e.target.value)}
                                         className="h-8" />
                                </TableCell>
                                <TableCell>
                                  <Select value={row.role} onValueChange={(v) => updateRow(row.id, 'role', v)}>
                                    <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="v">Voter only</SelectItem>
                                      <SelectItem value="o">Organizer only</SelectItem>
                                      <SelectItem value="vo">Both</SelectItem>
                                      <SelectItem value="none">None</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell>
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                          onClick={() => rows.length > 1 ? removeRow(row.id) : undefined}
                                          disabled={rows.length === 1}>✕</Button>
                                </TableCell>
                              </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <Button variant="outline" size="sm"
                            onClick={() => setRows(prev => [...prev, makeRow()])}>
                      + Add row
                    </Button>
                  </TabsContent>

                  {/* CSV input */}
                  <TabsContent value="csv" className="mt-4 space-y-3">
                    {/* Format guide */}
                    <div className="rounded-md bg-muted/40 border px-3.5 py-3 space-y-2">
                      <p className="text-xs font-semibold text-foreground">Expected CSV format</p>
                      <div className="font-mono text-xs text-muted-foreground space-y-0.5">
                        <p className="text-foreground">uid,contact,role</p>
                        <p>EMP001,alice@corp.com,v</p>
                        <p>EMP002,9876543210,vo</p>
                      </div>
                      <div className="flex gap-4 text-xs text-muted-foreground pt-0.5">
                        <span><span className="font-mono text-foreground">uid</span> — required</span>
                        <span><span className="font-mono text-foreground">contact</span> — email or mobile (either)</span>
                        <span><span className="font-mono text-foreground">role</span> — v = voter o = organizer vo = both none = none</span>
                      </div>
                    </div>

                    <Textarea
                        placeholder={`uid,contact,role\nEMP001,alice@corp.com,v\nEMP002,9876543210,vo`}
                        value={csvText}
                        onChange={(e) => { setCsvText(e.target.value); setCsvError(''); }}
                        rows={9}
                        className="font-mono text-sm"
                    />
                    {csvError && (
                        <p className="text-xs text-destructive flex items-center gap-1.5">
                          <span>⚠</span> {csvError}
                        </p>
                    )}
                  </TabsContent>
                </Tabs>
            )}

            {/* ── STEP 2: REVIEW ── */}
            {step === 'review' && (
                <div className="space-y-3">

                  {/* Default scope banner */}
                  <div className="rounded-md border bg-muted/30 px-4 py-3 flex items-start gap-3 flex-wrap">
                    <div className="flex-1 min-w-0 pt-0.5">
                      <p className="text-sm font-semibold text-foreground leading-tight">Default scope</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Applied to all members that don't have an individual scope override
                      </p>
                    </div>
                    <ScopeTreeSelect
                        scopeTree={scopeTree}
                        flatScopes={flatScopes}
                        value={defaultScopeId || 'all'}
                        onChange={(v) => setDefaultScopeId(v === 'all' ? '' : v)}
                        allowAll
                        placeholder="Org root (no override)"
                        className="w-56 flex-shrink-0"
                    />
                  </div>

                  {/* Filter bar */}
                  <div className="flex gap-2 flex-wrap items-center">
                    <div className="relative flex-1 min-w-36">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">⌕</span>
                      <Input
                          placeholder="Filter by UID or contact…"
                          value={reviewSearch}
                          onChange={(e) => setReviewSearch(e.target.value)}
                          className="pl-7 h-8 text-sm"
                      />
                      {reviewSearch && (
                          <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
                                  onClick={() => setReviewSearch('')}>✕</button>
                      )}
                    </div>
                    <Select value={reviewRoleFilter} onValueChange={(v) => setReviewRoleFilter(v as any)}>
                      <SelectTrigger className="w-36 h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All roles</SelectItem>
                        <SelectItem value="v">Voter only</SelectItem>
                        <SelectItem value="o">Organizer only</SelectItem>
                        <SelectItem value="vo">Voter + Org</SelectItem>
                        <SelectItem value="none">No roles</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground whitespace-nowrap">
                      {filteredRows.length === rows.length
                          ? `${validCount} member${validCount !== 1 ? 's' : ''}`
                          : `${filteredRows.length} of ${validCount} shown`}
                    </p>
                    {(reviewSearch || reviewRoleFilter !== 'all') && (
                        <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground"
                                onClick={() => { setReviewSearch(''); setReviewRoleFilter('all'); }}>
                          Clear
                        </Button>
                    )}
                  </div>

                  {/* Bulk scope assign bar — only when rows selected */}
                  {selectedIds.size > 0 && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg flex-wrap">
                        <span className="text-sm font-semibold text-primary tabular-nums">{selectedIds.size}</span>
                        <span className="text-sm text-muted-foreground">selected — set scope:</span>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="h-7 text-xs font-normal gap-1 min-w-32">
                        <span className={bulkScopeId ? 'text-foreground' : 'text-muted-foreground'}>
                          {bulkScopeId
                              ? (flatScopes.find(s => String(s.scope_id) === bulkScopeId)?.scope_name ?? 'Unknown')
                              : 'Pick scope…'}
                        </span>
                              <span className="text-[10px] text-muted-foreground">▾</span>
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="p-1 w-56" align="start" sideOffset={4}>
                            <div className="max-h-60 overflow-y-auto">
                              {scopeTree.length === 0
                                  ? <p className="text-xs text-muted-foreground px-2.5 py-2">No scopes available</p>
                                  : scopeTree.map(node => (
                                      <ScopeTreeSelectNode key={node.scope_id} node={node} depth={0}
                                                           value={bulkScopeId}
                                                           onSelect={(v) => setBulkScopeId(v)}
                                      />
                                  ))
                              }
                            </div>
                          </PopoverContent>
                        </Popover>
                        <Button size="sm" className="h-7 text-xs" onClick={applyBulkScope} disabled={!bulkScopeId}>
                          Apply to {selectedIds.size}
                        </Button>
                        <button className="text-xs text-muted-foreground hover:text-foreground ml-auto" onClick={clearSelection}>
                          ✕ Clear selection
                        </button>
                      </div>
                  )}

                  {/* Review table */}
                  <div className="border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10 pr-0">
                            <Checkbox
                                checked={allFilteredSelected}
                                ref={(el) => { if (el) (el as any).indeterminate = someFilteredSelected && !allFilteredSelected; }}
                                onCheckedChange={handleHeaderCheckbox}
                                disabled={filteredRows.length === 0}
                                aria-label="Select all"
                            />
                          </TableHead>
                          <TableHead className="w-28">UID</TableHead>
                          <TableHead>Contact</TableHead>
                          <TableHead className="w-28">Role</TableHead>
                          <TableHead>
                        <span className="flex items-center gap-1.5">
                          Scope
                          <span className="text-[10px] font-normal text-muted-foreground normal-case tracking-normal">
                            (click to override)
                          </span>
                        </span>
                          </TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRows.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center text-muted-foreground py-8 text-sm">
                                No members match your filters
                              </TableCell>
                            </TableRow>
                        ) : filteredRows.map((row) => {
                          const isSelected = selectedIds.has(row.id);
                          return (
                              <TableRow key={row.id}
                                        className={`transition-colors cursor-pointer ${isSelected ? 'bg-primary/5' : ''}`}
                                        onClick={() => toggleSelect(row.id)}
                              >
                                <TableCell className="pr-0" onClick={e => e.stopPropagation()}>
                                  <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(row.id)} />
                                </TableCell>
                                <TableCell onClick={e => e.stopPropagation()}>
                                  <Input value={row.uid}
                                         onChange={(e) => updateRow(row.id, 'uid', e.target.value.toUpperCase())}
                                         className="h-7 font-mono text-xs w-full" placeholder="UID" />
                                </TableCell>
                                <TableCell onClick={e => e.stopPropagation()}>
                                  <Input value={row.contact}
                                         onChange={(e) => updateRow(row.id, 'contact', e.target.value)}
                                         className="h-7 text-xs w-full" placeholder="email or mobile" />
                                </TableCell>
                                <TableCell onClick={e => e.stopPropagation()}>
                                  <Select value={row.role} onValueChange={(v) => updateRow(row.id, 'role', v)}>
                                    <SelectTrigger className="h-7 w-full text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="v">Voter only</SelectItem>
                                      <SelectItem value="o">Organizer only</SelectItem>
                                      <SelectItem value="vo">Both</SelectItem>
                                      <SelectItem value="none">None</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell onClick={e => e.stopPropagation()}>
                                  <RowScopePicker
                                      rowId={row.id}
                                      scopeId={row.scopeId}
                                      defaultScopeId={defaultScopeId}
                                      scopeTree={scopeTree}
                                      flatScopes={flatScopes}
                                      onChange={(id, val) => updateRow(id, 'scopeId', val)}
                                  />
                                </TableCell>
                                <TableCell onClick={e => e.stopPropagation()}>
                                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                          onClick={() => rows.length > 1 ? removeRow(row.id) : undefined}
                                          disabled={rows.length === 1}>✕</Button>
                                </TableCell>
                              </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Scope legend */}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground px-0.5 flex-wrap">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-primary/10 border border-primary/40 flex-shrink-0" />
                  Individual scope override (blue border)
                </span>
                    <span>·</span>
                    <span>No border = uses default scope above</span>
                    {rows.some(r => r.scopeId) && (
                        <>
                          <span>·</span>
                          <button className="text-primary hover:underline"
                                  onClick={() => setRows(prev => prev.map(r => ({ ...r, scopeId: '' })))}>
                            Clear all overrides
                          </button>
                        </>
                    )}
                  </div>
                </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t flex items-center justify-between gap-3">
            <div>
              {step === 'review' && (
                  <p className="text-xs text-muted-foreground">
                    {(() => {
                      const overrideCount = rows.filter(r => r.uid.trim() && r.scopeId).length;
                      const defaultCount = rows.filter(r => r.uid.trim() && !r.scopeId).length;
                      if (overrideCount === 0) return `All ${validCount} will use default scope`;
                      if (defaultCount === 0) return `All ${validCount} have individual scopes`;
                      return `${overrideCount} with scope override · ${defaultCount} using default`;
                    })()}
                  </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {step === 'input' ? (
                  <>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    {inputTab === 'csv' ? (
                        <Button onClick={parseCsvToReview} disabled={!csvText.trim()}>
                          Parse CSV →
                        </Button>
                    ) : (
                        <Button onClick={goToReview} disabled={!rows.some(r => r.uid.trim())}>
                          Review & assign scopes →
                        </Button>
                    )}
                  </>
              ) : (
                  <>
                    <Button variant="outline" onClick={() => { setStep('input'); setSelectedIds(new Set()); }} disabled={loading}>
                      ← Back
                    </Button>
                    <Button onClick={handleSubmit} disabled={loading || validCount === 0}>
                      {loading ? 'Adding…' : `Add ${validCount} member${validCount !== 1 ? 's' : ''}`}
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
  const [activeTab, setActiveTab] = useState('members');

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'organizer' | 'organizer-only' | 'voter' | 'voter-only' | 'none'>('all');
  const [scopeFilter, setScopeFilter] = useState<string>('all');

  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set());

  const [addMemberOpen, setAddMemberOpen] = useState(false);

  const [editMember, setEditMember] = useState<OrgMember | null>(null);
  const [removingUid, setRemovingUid] = useState<string | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false);
  const [bulkRemoveLoading, setBulkRemoveLoading] = useState(false);

  const [scopeTree, setScopeTree] = useState<ScopeNode[]>([]);
  const [flatScopes, setFlatScopes] = useState<ScopeNode[]>([]);
  const [selectedScope, setSelectedScope] = useState<ScopeNode | null>(null);
  const [scopeLoading, setScopeLoading] = useState(false);

  // ── Fetchers ──────────────────────────────────────────────────────────────────

  const fetchMembers = useCallback(async () => {
    setMembersLoading(true);
    try { setMembers(await api.getMembers(org.orgid, org.uid, {}) as OrgMember[]); }
    catch (e: any) { toast.error(e.message ?? 'Failed to load members'); }
    finally { setMembersLoading(false); }
  }, [org.orgid, org.uid]);

  const fetchScopes = useCallback(async () => {
    setScopeLoading(true);
    try {
      const data = await api.getScopeTree(org.orgid, org.uid) as ScopeNode[];
      setScopeTree(data);
      const flat = flattenTree(data);
      setFlatScopes(flat);
      if (selectedScope) setSelectedScope(flat.find((s) => s.scope_id === selectedScope.scope_id) ?? null);
    } catch (e: any) { toast.error(e.message ?? 'Failed to load scope tree'); }
    finally { setScopeLoading(false); }
  }, [org.orgid, org.uid]);

  useEffect(() => {
    if (activeTab === 'members') fetchMembers();
    if (activeTab === 'scope') fetchScopes();
  }, [activeTab, org.orgid]);

  // Load scopes in background (needed for filter dropdown + dialogs)
  useEffect(() => { if (activeTab === 'members' && flatScopes.length === 0) fetchScopes(); }, [activeTab]);

  // Clear selection when filters change
  useEffect(() => { setSelectedUids(new Set()); }, [searchQuery, roleFilter, scopeFilter]);

  // ── Filtering ─────────────────────────────────────────────────────────────────

  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return members.filter((m) => {
      const contact = (m.email ?? m.mobile ?? '').toLowerCase();
      if (q && !m.uid.toLowerCase().includes(q) && !contact.includes(q)) return false;
      if (roleFilter === 'organizer' && !m.is_organizer) return false;
      if (roleFilter === 'organizer-only' && (!m.is_organizer || m.is_voter)) return false;
      if (roleFilter === 'voter' && !m.is_voter) return false;
      if (roleFilter === 'voter-only' && (m.is_organizer || !m.is_voter)) return false;
      if (roleFilter === 'none' && (m.is_voter || m.is_organizer)) return false;
      if (scopeFilter !== 'all' && String(m.scope_id) !== scopeFilter) return false;
      return true;
    });
  }, [members, searchQuery, roleFilter, scopeFilter]);

  // ── Selection ─────────────────────────────────────────────────────────────────

  const selectableUids = filteredMembers.map((m) => m.uid).filter((uid) => uid !== org.uid);
  const allFilteredSelected = selectableUids.length > 0 && selectableUids.every((uid) => selectedUids.has(uid));
  const someSelected = selectableUids.some((uid) => selectedUids.has(uid));
  const selectedInView = filteredMembers.filter((m) => selectedUids.has(m.uid)).length;

  const toggleSelect = (uid: string) =>
      setSelectedUids((prev) => { const n = new Set(prev); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });
  const selectAllFiltered = () => setSelectedUids(new Set(selectableUids));
  const clearSelection = () => setSelectedUids(new Set());
  const handleHeaderCheckbox = () => {
    if (allFilteredSelected) setSelectedUids((prev) => { const n = new Set(prev); selectableUids.forEach((uid) => n.delete(uid)); return n; });
    else selectAllFiltered();
  };

  // ── Scope name lookup ─────────────────────────────────────────────────────────

  const getScopeName = (id: number | null | undefined) =>
      id == null ? '—' : flatScopes.find((s) => s.scope_id === id)?.scope_name ?? 'Unknown scope';

  // ── Remove ────────────────────────────────────────────────────────────────────

  const handleRemoveMember = async () => {
    if (!removingUid) return;
    setRemoveLoading(true);
    try { await api.removeMember(org.orgid, org.uid, removingUid); toast.success(`${removingUid} removed`); setRemovingUid(null); fetchMembers(); }
    catch (e: any) { toast.error(e.message ?? 'Failed to remove member'); }
    finally { setRemoveLoading(false); }
  };

  const handleBulkRemove = async () => {
    setBulkRemoveLoading(true);
    let successCount = 0;
    for (const uid of Array.from(selectedUids)) {
      try { await api.removeMember(org.orgid, org.uid, uid); successCount++; }
      catch (e: any) { toast.error(`${uid}: ${e.message ?? 'error'}`); }
    }
    if (successCount > 0) toast.success(`Removed ${successCount} member${successCount !== 1 ? 's' : ''}`);
    setBulkRemoveLoading(false); setBulkRemoveOpen(false); clearSelection(); fetchMembers();
  };

  const hasActiveFilters = searchQuery.trim() || roleFilter !== 'all' || scopeFilter !== 'all';

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold leading-tight">{org.org_name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">{org.orgid}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">Your UID: <span className="font-mono font-semibold text-foreground">{org.uid}</span></span>
            </div>
          </div>
          <Badge variant={org.is_active ? 'default' : 'secondary'} className="flex-shrink-0 mt-0.5">
            {org.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="scope">Scope Tree</TabsTrigger>
          </TabsList>

          {/* ── MEMBERS TAB ── */}
          <TabsContent value="members" className="space-y-3 mt-4">

            {/* Filter bar */}
            <div className="space-y-2">
              <div className="flex gap-2 flex-wrap items-center">
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">⌕</span>
                  <Input placeholder="Search UID, email or mobile…" value={searchQuery}
                         onChange={(e) => setSearchQuery(e.target.value)} className="pl-7 w-56" />
                  {searchQuery && (
                      <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
                              onClick={() => setSearchQuery('')}>✕</button>
                  )}
                </div>

                <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as any)}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
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
                    scopeTree={scopeTree} flatScopes={flatScopes}
                    value={scopeFilter} onChange={setScopeFilter}
                    allowAll placeholder="All scopes" className="w-44"
                />

                {hasActiveFilters && (
                    <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-9"
                            onClick={() => { setSearchQuery(''); setRoleFilter('all'); setScopeFilter('all'); }}>
                      Clear filters
                    </Button>
                )}

                <div className="ml-auto flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={fetchMembers}>Refresh</Button>
                  <Button size="sm" onClick={() => setAddMemberOpen(true)}>+ Add Members</Button>
                </div>
              </div>

              <div className="flex items-center gap-2 px-0.5">
                <p className="text-xs text-muted-foreground">
                  {filteredMembers.length === members.length
                      ? `${members.length} member${members.length !== 1 ? 's' : ''}`
                      : `${filteredMembers.length} of ${members.length} members`}
                </p>
                {hasActiveFilters && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Filtered</Badge>}
              </div>
            </div>

            {selectedUids.size > 0 && (
                <BulkActionBar
                    selectedCount={selectedUids.size} totalCount={selectableUids.length}
                    onSelectAll={selectAllFiltered} onClearSelection={clearSelection}
                    onBulkEdit={() => setBulkEditOpen(true)} onBulkRemove={() => setBulkRemoveOpen(true)}
                />
            )}

            {membersLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">Loading members…</div>
            ) : (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10 pr-0">
                          <Checkbox
                              checked={allFilteredSelected}
                              ref={(el) => { if (el) (el as any).indeterminate = someSelected && !allFilteredSelected; }}
                              onCheckedChange={handleHeaderCheckbox}
                              disabled={selectableUids.length === 0}
                              aria-label="Select all"
                          />
                        </TableHead>
                        <TableHead>UID</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Roles</TableHead>
                        <TableHead>Scope</TableHead>
                        <TableHead className="w-20 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredMembers.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                              {hasActiveFilters ? (
                                  <div className="space-y-1">
                                    <p>No members match your filters.</p>
                                    <button className="text-xs text-primary hover:underline"
                                            onClick={() => { setSearchQuery(''); setRoleFilter('all'); setScopeFilter('all'); }}>
                                      Clear filters
                                    </button>
                                  </div>
                              ) : 'No members found'}
                            </TableCell>
                          </TableRow>
                      ) : filteredMembers.map((m) => {
                        const isSelected = selectedUids.has(m.uid);
                        const isSelf = m.uid === org.uid;
                        const q = searchQuery.toLowerCase();
                        return (
                            <TableRow key={m.uid}
                                      className={`transition-colors ${isSelected ? 'bg-primary/5' : ''} ${isSelf ? 'opacity-75' : ''}`}
                                      onClick={() => !isSelf && toggleSelect(m.uid)}
                                      style={{ cursor: isSelf ? 'default' : 'pointer' }}
                            >
                              <TableCell className="pr-0" onClick={(e) => e.stopPropagation()}>
                                <Checkbox checked={isSelected} onCheckedChange={() => !isSelf && toggleSelect(m.uid)} disabled={isSelf} />
                              </TableCell>
                              <TableCell className="font-mono font-semibold text-sm">
                                {m.uid}
                                {isSelf && <span className="ml-1.5 text-[10px] font-normal text-muted-foreground bg-muted px-1 rounded">you</span>}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {(() => {
                                  const contact = m.email ?? m.mobile ?? null;
                                  if (!contact) return '—';
                                  const isMatch = q && contact.toLowerCase().includes(q);
                                  return isMatch
                                      ? <span className="bg-yellow-100 dark:bg-yellow-900/40 rounded px-0.5">{contact}</span>
                                      : contact;
                                })()}
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1 flex-wrap">
                                  {m.is_voter && <Badge variant="outline" className="text-xs">Voter</Badge>}
                                  {m.is_organizer && <Badge className="text-xs">Organizer</Badge>}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">{getScopeName(m.scope_id)}</TableCell>
                              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                                <div className="flex justify-end gap-1">
                                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditMember(m)}>Edit</Button>
                                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                                          onClick={() => setRemovingUid(m.uid)} disabled={isSelf}>Remove</Button>
                                </div>
                              </TableCell>
                            </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
            )}

            {selectedUids.size > 0 && filteredMembers.length > 0 && (
                <p className="text-xs text-muted-foreground px-0.5">
                  {selectedInView} row{selectedInView !== 1 ? 's' : ''} selected in current view
                  {selectedUids.size !== selectedInView && ` · ${selectedUids.size} total across all filters`}
                </p>
            )}

            {/* Add members — new 2-step dialog */}
            <AddMembersDialog
                open={addMemberOpen}
                org={org}
                scopeTree={scopeTree}
                flatScopes={flatScopes}
                onClose={() => setAddMemberOpen(false)}
                onSuccess={fetchMembers}
            />

            {/* Edit single member */}
            <EditMemberDialog
                open={editMember !== null} member={editMember} org={org}
                scopeTree={scopeTree} flatScopes={flatScopes}
                onClose={() => setEditMember(null)} onSuccess={fetchMembers}
            />

            {/* Bulk edit */}
            <BulkEditDialog
                open={bulkEditOpen} selectedUids={Array.from(selectedUids)} org={org}
                scopeTree={scopeTree} flatScopes={flatScopes}
                onClose={() => setBulkEditOpen(false)}
                onSuccess={() => { clearSelection(); fetchMembers(); }}
            />

            {/* Remove single */}
            <AlertDialog open={removingUid !== null} onOpenChange={(o) => !o && setRemovingUid(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {removingUid}?</AlertDialogTitle>
                  <AlertDialogDescription>This member will be deactivated from {org.org_name}. They can be re-added later.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={removeLoading}>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRemoveMember} disabled={removeLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    {removeLoading ? 'Removing…' : 'Remove Member'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Bulk remove */}
            <AlertDialog open={bulkRemoveOpen} onOpenChange={(o) => !o && setBulkRemoveOpen(false)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {selectedUids.size} member{selectedUids.size !== 1 ? 's' : ''}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    These members will be deactivated from {org.org_name}.
                    <div className="mt-2 max-h-24 overflow-y-auto font-mono text-xs bg-muted rounded p-2 space-y-0.5">
                      {Array.from(selectedUids).map((uid) => <div key={uid}>{uid}</div>)}
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={bulkRemoveLoading}>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleBulkRemove} disabled={bulkRemoveLoading} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    {bulkRemoveLoading ? 'Removing…' : `Remove ${selectedUids.size} member${selectedUids.size !== 1 ? 's' : ''}`}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>

          {/* ── SCOPE TAB ── */}
          <TabsContent value="scope" className="mt-4">
            {scopeLoading ? (
                <div className="py-10 text-center text-sm text-muted-foreground">Loading scope tree…</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm">Hierarchy</CardTitle>
                      <CardDescription className="text-xs">Click a node to view or edit</CardDescription>
                    </CardHeader>
                    <CardContent className="px-2 pb-4">
                      {scopeTree.length === 0
                          ? <p className="text-sm text-muted-foreground px-2">No scopes found</p>
                          : scopeTree.map((root) => (
                              <ScopeTreeNode key={root.scope_id} node={root} depth={0}
                                             selectedId={selectedScope?.scope_id ?? null} onSelect={setSelectedScope} />
                          ))
                      }
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm">{selectedScope ? 'Scope Actions' : 'Select a Scope'}</CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-4">
                      {!selectedScope
                          ? <p className="text-sm text-muted-foreground">Select a node from the hierarchy to rename, add children, or delete it.</p>
                          : <ScopeActionsPanel key={selectedScope.scope_id} node={selectedScope} org={org} flatScopes={flatScopes} onRefresh={fetchScopes} />
                      }
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

  const isUnified = session?.type === 'UNIFIED';
  const isGov = session?.type === 'GOV';
  const isOrg = session?.type === 'ORG';

  const fetchOrgs = async () => {
    setLoading(true);
    try {
      const data = await api.getMyOrgs() as OrgSummary[];
      const filtered = isOrg ? data.filter((o) => o.orgid === session?.orgid) : data;
      setOrgs(filtered);
      setSelectedOrg((prev) => {
        if (isOrg) return filtered[0] ?? null;
        if (prev) return filtered.find((o) => o.orgid === prev.orgid) ?? filtered[0] ?? null;
        return filtered[0] ?? null;
      });
    } catch (e: any) { toast.error(e.message ?? 'Failed to load organizations'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (isGov) { setLoading(false); return; } fetchOrgs(); }, []);

  if (isGov) {
    return (
        <div className="max-w-5xl mx-auto">
          <div className="mb-6"><h1 className="text-2xl font-bold tracking-tight mb-1">Organizations</h1></div>
          <Card>
            <CardContent className="py-10 text-center space-y-2">
              <p className="font-semibold">Not available</p>
              <p className="text-sm text-muted-foreground">Organization management requires a Unified or Organization session.</p>
            </CardContent>
          </Card>
        </div>
    );
  }

  return (
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight mb-1">Organizations</h1>
            <p className="text-sm text-muted-foreground">
              {isUnified ? 'Organizations where you hold an Organizer role' : `Managing ${selectedOrg?.org_name ?? 'your organization'}`}
            </p>
          </div>
          {isUnified && <Button onClick={() => setRegisterOpen(true)} className="flex-shrink-0">+ Register Org</Button>}
        </div>

        {loading ? (
            <div className="py-16 text-center text-muted-foreground text-sm">Loading organizations…</div>
        ) : orgs.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center space-y-3">
                {isUnified ? (
                    <>
                      <p className="text-muted-foreground">You don't have any organizations yet.</p>
                      <Button onClick={() => setRegisterOpen(true)}>Register your first organization</Button>
                    </>
                ) : <p className="text-muted-foreground">No organization found for this session. You may not have an Organizer role.</p>}
              </CardContent>
            </Card>
        ) : isOrg ? (
            <Card><CardContent className="pt-5 pb-6 px-5">{selectedOrg && <ManageOrgPanel key={selectedOrg.orgid} org={selectedOrg} />}</CardContent></Card>
        ) : (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-1 space-y-1.5">
                {orgs.map((org) => (
                    <button key={org.orgid} onClick={() => setSelectedOrg(org)}
                            className={`w-full text-left px-3 py-2.5 rounded-md border transition-colors
                  ${selectedOrg?.orgid === org.orgid ? 'bg-accent border-primary/40 font-semibold' : 'border-border hover:bg-accent/50'}`}>
                      <p className="text-sm font-semibold truncate leading-tight">{org.org_name}</p>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{org.orgid}</p>
                      {!org.is_active && <Badge variant="secondary" className="text-[10px] mt-1 h-4">Inactive</Badge>}
                    </button>
                ))}
              </div>
              <div className="md:col-span-3">
                {selectedOrg
                    ? <Card><CardContent className="pt-5 pb-6 px-5"><ManageOrgPanel key={selectedOrg.orgid} org={selectedOrg} /></CardContent></Card>
                    : <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">Select an organization to manage</CardContent></Card>
                }
              </div>
            </div>
        )}

        {isUnified && <RegisterOrgModal open={registerOpen} onClose={() => setRegisterOpen(false)} onSuccess={fetchOrgs} />}
      </div>
  );
}