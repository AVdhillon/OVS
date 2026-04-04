import {useState, useEffect, useCallback} from 'react';
import {useAppContext, OrgSummary, ScopeNode, VotingEvent, Candidate} from '../context/app-context';
import {api} from '../../lib/api';
import {Card, CardContent, CardHeader, CardTitle, CardDescription} from '../components/ui/card';
import {Input} from '../components/ui/input';
import {Label} from '../components/ui/label';
import {Button} from '../components/ui/button';
import {Textarea} from '../components/ui/textarea';
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '../components/ui/select';
import {Switch} from '../components/ui/switch';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '../components/ui/tabs';
import {Badge} from '../components/ui/badge';
import {Skeleton} from '../components/ui/skeleton';
import {Separator} from '../components/ui/separator';
import {Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription} from '../components/ui/sheet';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '../components/ui/alert-dialog';
import {Calendar} from '../components/ui/calendar';
import {Popover, PopoverContent, PopoverTrigger} from '../components/ui/popover';
import {
    Plus,
    X,
    Calendar as CalendarIcon,
    Pencil,
    Trash2,
    AlertCircle,
    ChevronRight,
    FolderTree,
    Users,
    Clock,
    BarChart3,
    RefreshCw,
    CheckCircle2,
} from 'lucide-react';
import {format, isFuture, isPast, isValid, isSameDay, isSameYear} from 'date-fns';
import {toast} from 'sonner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flattenScope(nodes: ScopeNode[], depth = 0): { node: ScopeNode; depth: number }[] {
    return nodes.flatMap((n) => [{node: n, depth}, ...flattenScope(n.children, depth + 1)]);
}

function toISO(date: Date, time: string): string {
    const [h, m] = time.split(':').map(Number);
    const d = new Date(date);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
}

function canEditEvent(event: VotingEvent): boolean {
    return isFuture(new Date(event.start_time)) && event.status !== 'CANCELLED';
}

function EventStatusBadge({event}: { event: VotingEvent }) {
    if (event.status === 'CANCELLED')
        return <Badge variant="outline" className="text-xs bg-red-50 text-red-600 border-red-200">Cancelled</Badge>;
    if (event.status === 'COMPLETED')
        return <Badge variant="outline"
                      className="text-xs bg-slate-100 text-slate-600 border-slate-200">Completed</Badge>;
    if (isFuture(new Date(event.start_time)))
        return <Badge variant="outline"
                      className="text-xs bg-amber-50 text-amber-700 border-amber-200">Upcoming</Badge>;
    if (isPast(new Date(event.end_time)))
        return <Badge variant="outline" className="text-xs bg-slate-100 text-slate-600 border-slate-200">Ended</Badge>;
    return (
        <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200">
            <span className="mr-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"/>
            Live
        </Badge>
    );
}

// ─── Candidate Draft (local, pre-submit) ──────────────────────────────────────

interface CandidateDraft {
    _key: string;
    candidate_name: string;
    description: string;
}

// ─── Candidate List Editor ────────────────────────────────────────────────────

function CandidateEditor({
                             candidates,
                             onChange,
                         }: {
    candidates: CandidateDraft[];
    onChange: (c: CandidateDraft[]) => void;
}) {
    const [name, setName] = useState('');
    const [desc, setDesc] = useState('');

    const add = () => {
        if (!name.trim()) return;
        onChange([...candidates, {_key: `${Date.now()}`, candidate_name: name.trim(), description: desc.trim()}]);
        setName('');
        setDesc('');
    };

    const remove = (key: string) => onChange(candidates.filter((c) => c._key !== key));

    return (
        <div className="space-y-4">
            <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                        <Label>Candidate Name</Label>
                        <Input
                            placeholder="Full name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && add()}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>
                            Description <span className="text-muted-foreground font-normal text-xs">(optional)</span>
                        </Label>
                        <Input
                            placeholder="Brief bio or role"
                            value={desc}
                            onChange={(e) => setDesc(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && add()}
                        />
                    </div>
                </div>
                <Button onClick={add} variant="outline" size="sm" disabled={!name.trim()}>
                    <Plus className="h-3.5 w-3.5 mr-1.5"/>
                    Add Candidate
                </Button>
            </div>

            {candidates.length > 0 && (
                <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                        {candidates.length} candidate{candidates.length !== 1 ? 's' : ''} added
                        {candidates.length < 2 && (
                            <span className="text-amber-600 ml-1">(minimum 2 required)</span>
                        )}
                    </p>
                    {candidates.map((c, i) => (
                        <div key={c._key} className="flex items-start gap-3 p-3 border rounded-lg bg-background">
                            <div
                                className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
                                {i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">{c.candidate_name}</p>
                                {c.description &&
                                    <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>}
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                                onClick={() => remove(c._key)}
                            >
                                <X className="h-3.5 w-3.5"/>
                            </Button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Options Panel (shared) ───────────────────────────────────────────────────

interface OptionsState {
    show_live_results: boolean;
    visible_upward: boolean;
    scope_only: boolean;
}

function EventOptions({value, onChange}: { value: OptionsState; onChange: (v: OptionsState) => void }) {
    const set = (key: keyof OptionsState, val: boolean) => {
        const next = {...value, [key]: val};
        if (key === 'visible_upward' && val) next.scope_only = false;
        if (key === 'scope_only' && val) next.visible_upward = false;
        onChange(next);
    };

    return (
        <div className="space-y-4">
            {([
                {
                    key: 'show_live_results',
                    label: 'Show live results',
                    desc: 'Participants see real-time tallies during the event'
                },
                {
                    key: 'visible_upward',
                    label: 'Visible upward',
                    desc: 'Event appears to parent scopes (mutually exclusive with scope-only)'
                },
                {
                    key: 'scope_only',
                    label: 'Scope only',
                    desc: 'Restrict visibility strictly to the selected scope (mutually exclusive with visible-upward)'
                },
            ] as { key: keyof OptionsState; label: string; desc: string }[]).map(({key, label, desc}) => (
                <div key={key} className="flex items-center justify-between gap-4">
                    <div>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                    <Switch
                        checked={value[key]}
                        onCheckedChange={(v) => set(key, v)}
                        disabled={(key === 'visible_upward' && value.scope_only) || (key === 'scope_only' && value.visible_upward)}
                    />
                </div>
            ))}
        </div>
    );
}

// ─── Scope Selector ────────────────────────────────────────────────────────────

function ScopeSelector({
                           orgid,
                           uid,
                           value,
                           onChange,
                       }: {
    orgid: string;
    uid: string;
    value: number | null;
    onChange: (id: number | null) => void;
}) {
    const [tree, setTree] = useState<ScopeNode[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!orgid || !uid) return;
        setLoading(true);
        api.getScopeTree(orgid, uid)
            .then(setTree)
            .catch(() => toast.error('Failed to load scope tree'))
            .finally(() => setLoading(false));
    }, [orgid, uid]);

    if (loading) return <Skeleton className="h-9 w-full"/>;

    const flat = flattenScope(tree);

    return (
        <Select value={value?.toString() ?? ''} onValueChange={(v) => onChange(v ? Number(v) : null)}>
            <SelectTrigger>
                <SelectValue placeholder="Defaults to org root"/>
            </SelectTrigger>
            <SelectContent>
                {flat.map(({node, depth}) => (
                    <SelectItem key={node.scope_id} value={node.scope_id.toString()}>
            <span className="flex items-center gap-1.5" style={{paddingLeft: `${depth * 12}px`}}>
              {depth > 0 && <span className="text-muted-foreground text-xs">↳</span>}
                {node.scope_name}
            </span>
                    </SelectItem>
                ))}
                {flat.length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No scopes found</div>
                )}
            </SelectContent>
        </Select>
    );
}

// ─── Edit Event Sheet ─────────────────────────────────────────────────────────

function EditEventSheet({
                            event,
                            onClose,
                            onSaved,
                        }: {
    event: VotingEvent | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [startDate, setStartDate] = useState<Date>();
    const [startTime, setStartTime] = useState('09:00');
    const [endDate, setEndDate] = useState<Date>();
    const [endTime, setEndTime] = useState('17:00');
    const [options, setOptions] = useState<OptionsState>({
        show_live_results: true,
        visible_upward: false,
        scope_only: false
    });
    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [newCandName, setNewCandName] = useState('');
    const [newCandDesc, setNewCandDesc] = useState('');
    const [candidateLoading, setCandidateLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const editable = event ? canEditEvent(event) : false;

    useEffect(() => {
        if (!event) return;
        setTitle(event.title);
        setDescription(event.description ?? '');
        const s = new Date(event.start_time);
        const e = new Date(event.end_time);
        setStartDate(s);
        setStartTime(format(s, 'HH:mm'));
        setEndDate(e);
        setEndTime(format(e, 'HH:mm'));
        setOptions({
            show_live_results: event.show_live_results,
            visible_upward: event.visibility_upward,
            scope_only: event.scope_only
        });
        setCandidates(event.candidates ?? []);
    }, [event]);

    const handleSave = async () => {
        if (!event || !startDate || !endDate) return;
        setSaving(true);
        try {
            await api.updateEvent(event.orgid, event.event_id, event.acting_uid,{  // pass orgId first
                title: title.trim(),
                description: description.trim() || undefined,
                start_time: toISO(startDate, startTime),
                end_time: toISO(endDate, endTime),
                show_live_results: options.show_live_results,
                visible_upward: options.visible_upward,
                scope_only: options.scope_only,
            });
            toast.success('Event updated');
            onSaved();
        } catch (e: any) {
            toast.error(e.message ?? 'Failed to update event');
        } finally {
            setSaving(false);
        }
    };

    const handleAddCandidate = async () => {
        if (!event || !newCandName.trim()) return;
        setCandidateLoading(true);
        try {
            await api.addCandidate(event.event_id, {
                candidate_name: newCandName.trim(),
                description: newCandDesc.trim() || undefined
            });
            toast.success('Candidate added');
            setNewCandName('');
            setNewCandDesc('');
            const fresh = await api.getEvent(event.event_id);
            setCandidates(fresh.candidates ?? []);
        } catch (e: any) {
            toast.error(e.message ?? 'Failed to add candidate');
        } finally {
            setCandidateLoading(false);
        }
    };

    const handleRemoveCandidate = async (candidateId: number) => {
        if (!event) return;
        if (candidates.length <= 2) {
            toast.error('At least 2 candidates must remain');
            return;
        }
        setCandidateLoading(true);
        try {
            await api.removeCandidate(event.event_id, candidateId);
            setCandidates((prev) => prev.filter((c) => c.candidate_id !== candidateId));
            toast.success('Candidate removed');
        } catch (e: any) {
            toast.error(e.message ?? 'Failed to remove candidate');
        } finally {
            setCandidateLoading(false);
        }
    };

    return (
        <Sheet open={!!event} onOpenChange={(open) => !open && onClose()}>
            <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col gap-0 p-0">
                <SheetHeader className="px-6 py-5 border-b">
                    <SheetTitle className="text-left">{editable ? 'Edit Event' : 'Event Details'}</SheetTitle>
                    <SheetDescription className="text-left text-sm">
                        {editable ? 'Update event details. Changes take effect immediately.' : 'This event has started or ended and cannot be edited.'}
                    </SheetDescription>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                    {/* Details */}
                    <section className="space-y-4">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Details</p>
                        <div className="space-y-2">
                            <Label>Title</Label>
                            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!editable}/>
                        </div>
                        <div className="space-y-2">
                            <Label>Description</Label>
                            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
                                      disabled={!editable}/>
                        </div>
                    </section>

                    <Separator/>

                    {/* Timeline */}
                    <section className="space-y-4">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Timeline</p>
                        <div className="grid grid-cols-2 gap-3">
                            {([
                                {
                                    label: 'Start',
                                    date: startDate,
                                    setDate: setStartDate,
                                    time: startTime,
                                    setTime: setStartTime
                                },
                                {label: 'End', date: endDate, setDate: setEndDate, time: endTime, setTime: setEndTime},
                            ] as any[]).map(({label, date, setDate, time, setTime}) => (
                                <div key={label} className="space-y-2">
                                    <Label>{label}</Label>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" size="sm" className="w-full justify-start text-xs"
                                                    disabled={!editable}>
                                                <CalendarIcon className="h-3.5 w-3.5 mr-1.5"/>
                                                {date ? format(date, 'MMM d, yyyy') : 'Pick date'}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0">
                                            <Calendar mode="single" selected={date} onSelect={setDate}/>
                                        </PopoverContent>
                                    </Popover>
                                    <Input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                                           disabled={!editable} className="text-xs"/>
                                </div>
                            ))}
                        </div>
                    </section>

                    <Separator/>

                    {/* Options */}
                    <section className="space-y-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Options</p>
                        {editable ? (
                            <EventOptions value={options} onChange={setOptions}/>
                        ) : (
                            <div className="space-y-2 text-sm">
                                {([
                                    ['Live results', event?.show_live_results],
                                    ['Visible upward', event?.visibility_upward],
                                    ['Scope only', event?.scope_only],
                                ] as [string, boolean | undefined][]).map(([label, val]) => (
                                    <div key={label} className="flex items-center justify-between">
                                        <span className="text-muted-foreground">{label}</span>
                                        {val ? <CheckCircle2 className="h-4 w-4 text-emerald-500"/> :
                                            <X className="h-4 w-4 text-muted-foreground/30"/>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <Separator/>

                    {/* Candidates */}
                    <section className="space-y-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Candidates ({candidates.length})
                        </p>
                        <div className="space-y-2">
                            {candidates.map((c, i) => (
                                <div key={c.candidate_id} className="flex items-start gap-3 p-3 border rounded-lg">
                                    <div
                                        className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
                                        {i + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium">{c.candidate_name}</p>
                                        {c.description &&
                                            <p className="text-xs text-muted-foreground">{c.description}</p>}
                                    </div>
                                    {editable && (
                                        <Button
                                            variant="ghost" size="icon"
                                            className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                                            onClick={() => handleRemoveCandidate(c.candidate_id)}
                                            disabled={candidateLoading}
                                        >
                                            <X className="h-3.5 w-3.5"/>
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>

                        {editable && (
                            <div className="space-y-2 p-3 border rounded-lg bg-muted/30">
                                <p className="text-xs font-medium text-muted-foreground">Add candidate</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <Input placeholder="Name" value={newCandName}
                                           onChange={(e) => setNewCandName(e.target.value)} className="text-sm"/>
                                    <Input placeholder="Description (optional)" value={newCandDesc}
                                           onChange={(e) => setNewCandDesc(e.target.value)} className="text-sm"/>
                                </div>
                                <Button size="sm" variant="outline" onClick={handleAddCandidate}
                                        disabled={!newCandName.trim() || candidateLoading}>
                                    <Plus className="h-3.5 w-3.5 mr-1.5"/> Add
                                </Button>
                            </div>
                        )}
                    </section>
                </div>

                {editable && (
                    <div className="px-6 py-4 border-t flex gap-3">
                        <Button variant="outline" onClick={onClose} className="flex-1" disabled={saving}>Cancel</Button>
                        <Button onClick={handleSave} className="flex-1" disabled={saving}>
                            {saving ? 'Saving…' : 'Save Changes'}
                        </Button>
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}

// ─── My Events List ───────────────────────────────────────────────────────────

function MyEventsList({
                          orgs,
                          onEdit,
                          onDeleted,
                      }: {
    orgs: OrgSummary[];
    onEdit: (event: VotingEvent) => void;
    onDeleted: () => void;
}) {
    const {events} = useAppContext();

    const [deleteTarget, setDeleteTarget] = useState<VotingEvent | null>(null);
    const [deleting, setDeleting] = useState(false);

    //const managed = [...events.active_pending, ...events.completed]
    const managed = Object.values(events ?? {}).flat()
        .filter((e) => e.is_organizer || e.created_by_uid === e.acting_uid);
    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await api.deleteEvent(deleteTarget.event_id);
            toast.success('Event cancelled');
            setDeleteTarget(null);
            onDeleted();
        } catch (e: any) {
            toast.error(e.message ?? 'Failed to cancel event');
        } finally {
            setDeleting(false);
        }
    };

    if (managed.length === 0) {
        return (
            <Card className="border-dashed">
                <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
                    <CalendarIcon className="h-8 w-8 opacity-30"/>
                    <p className="text-sm">No events found for your managed organisations</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <>
            <div className="space-y-3">
                {managed.map((event) => {
                    const editable = canEditEvent(event);
                    return (
                        <Card key={event.event_id} className="hover:shadow-sm transition-shadow">
                            <CardContent className="py-4 px-5">
                                <div className="flex items-start gap-4">
                                    <div className="flex-1 min-w-0 space-y-1.5">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <EventStatusBadge event={event}/>
                                            <span
                                                className="text-xs text-muted-foreground font-mono">{event.orgid}</span>
                                        </div>
                                        <p className="font-medium text-sm leading-snug">{event.title}</p>
                                        <div
                                            className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">

                                            <span className="flex items-center gap-1">
                                                <Clock className="h-3 w-3"/>
                                                {formatEventTime(event.start_time, event.end_time)}
                                            </span>
                                            {event.candidates && (
                                                <span className="flex items-center gap-1">
                          <Users className="h-3 w-3"/>
                                                    {event.candidates.length} candidates
                        </span>
                                            )}
                                            {event.show_live_results && (
                                                <span className="flex items-center gap-1 text-emerald-600">
                          <BarChart3 className="h-3 w-3"/> Live results
                        </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <Button variant="ghost" size="icon" className="h-8 w-8"
                                                onClick={() => onEdit(event)} title={editable ? 'Edit' : 'View'}>
                                            <Pencil className="h-3.5 w-3.5"/>
                                        </Button>
                                        {editable && (
                                            <Button variant="ghost" size="icon"
                                                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                    onClick={() => setDeleteTarget(event)}>
                                                <Trash2 className="h-3.5 w-3.5"/>
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Cancel this event?</AlertDialogTitle>
                        <AlertDialogDescription>
                            <strong className="text-foreground">{deleteTarget?.title}</strong> will be cancelled. This
                            cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>Go back</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} disabled={deleting}
                                           className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            {deleting ? 'Cancelling…' : 'Cancel Event'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

// ─── Create Event Form ────────────────────────────────────────────────────────

function CreateEventForm({
                             orgs,
                             onCreated,
                             lockedOrg,
                         }: {
    orgs: OrgSummary[];
    onCreated: () => void;
    lockedOrg?: OrgSummary;          // ← NEW: injected by ManageEventsView for ORG sessions
}) {
    const [selectedOrgId, setSelectedOrgId] = useState(lockedOrg?.orgid ?? '');
    const [scopeId, setScopeId] = useState<number | null>(null);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [startDate, setStartDate] = useState<Date>();
    const [startTime, setStartTime] = useState('09:00');
    const [endDate, setEndDate] = useState<Date>();
    const [endTime, setEndTime] = useState('17:00');
    const [candidates, setCandidates] = useState<CandidateDraft[]>([]);
    const [options, setOptions] = useState<OptionsState>({
        show_live_results: true,
        visible_upward: false,
        scope_only: false,
    });
    const [submitting, setSubmitting] = useState(false);

    // Keep locked org in sync if it arrives after first render
    useEffect(() => {
        if (lockedOrg) setSelectedOrgId(lockedOrg.orgid);
    }, [lockedOrg?.orgid]);

    const selectedOrg = lockedOrg ?? orgs.find((o) => o.orgid === selectedOrgId) ?? null;

    const handlePublish = async () => {
        if (!selectedOrg || !title.trim() || !startDate || !endDate) {
            toast.error('Please fill in all required fields');
            return;
        }
        if (candidates.length < 2) {
            toast.error('At least 2 candidates are required');
            return;
        }
        const startISO = toISO(startDate, startTime);
        const endISO = toISO(endDate, endTime);
        if (new Date(startISO) >= new Date(endISO)) {
            toast.error('End time must be after start time');
            return;
        }

        setSubmitting(true);
        try {
            await api.createEvent({
                orgid: selectedOrg.orgid,
                uid: selectedOrg.uid,
                scope_id: scopeId,
                title: title.trim(),
                description: description.trim() || undefined,
                start_time: startISO,
                end_time: endISO,
                candidates: candidates.map((c) => ({
                    candidate_name: c.candidate_name,
                    description: c.description || undefined,
                })),
                show_live_results: options.show_live_results,
                visible_upward: options.visible_upward,
                scope_only: options.scope_only,
            });

            toast.success('Event published successfully');
            // Reset (but keep org locked if in ORG session)
            if (!lockedOrg) setSelectedOrgId('');
            setScopeId(null);
            setTitle('');
            setDescription('');
            setStartDate(undefined);
            setEndDate(undefined);
            setStartTime('09:00');
            setEndTime('17:00');
            setCandidates([]);
            setOptions({show_live_results: true, visible_upward: false, scope_only: false});
            onCreated();
        } catch (e: any) {
            toast.error(e.message ?? 'Failed to publish event');
        } finally {
            setSubmitting(false);
        }
    };

    const steps = [
        {
            num: 1,
            title: 'Organisation & Scope',
            desc: lockedOrg
                ? `Creating under ${lockedOrg.org_name} · choose a scope`
                : "Select which org you're creating the event for",
            content: (
                <div className="space-y-4">
                    {/* Org selector — hidden for ORG sessions, replaced by a read-only pill */}
                    {lockedOrg ? (
                        <div className="flex items-center gap-3 p-3 rounded-md border bg-muted/40">
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold truncate">{lockedOrg.org_name}</p>
                                <p className="text-xs font-mono text-muted-foreground">{lockedOrg.orgid}</p>
                            </div>
                            <Badge variant="secondary" className="text-xs shrink-0">Session org</Badge>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <Label>Organisation <span className="text-destructive">*</span></Label>
                            {orgs.length === 0 ? (
                                <div
                                    className="flex items-center gap-2 text-sm text-muted-foreground p-3 bg-muted/50 rounded-md">
                                    <AlertCircle className="h-4 w-4"/>
                                    You are not an organizer in any active organisation
                                </div>
                            ) : (
                                <Select value={selectedOrgId} onValueChange={(v) => {
                                    setSelectedOrgId(v);
                                    setScopeId(null);
                                }}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Choose an organisation"/>
                                    </SelectTrigger>
                                    <SelectContent>
                                        {orgs.map((org) => (
                                            <SelectItem key={org.orgid} value={org.orgid}>
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium">{org.org_name}</span>
                                                    <span
                                                        className="text-muted-foreground font-mono text-xs">{org.orgid}</span>
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                    )}

                    {/* Scope selector — always shown once an org is resolved */}
                    {selectedOrg && (
                        <div className="space-y-2">
                            <Label className="flex items-center gap-1.5">
                                <FolderTree className="h-3.5 w-3.5"/>
                                Scope
                                <span
                                    className="text-muted-foreground font-normal text-xs">(defaults to org root)</span>
                            </Label>
                            <ScopeSelector
                                orgid={selectedOrg.orgid}
                                uid={selectedOrg.uid}
                                value={scopeId}
                                onChange={setScopeId}
                            />
                        </div>
                    )}
                </div>
            ),
        },
        {
            num: 2,
            title: 'Event Details',
            desc: 'Title and description',
            content: (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Title <span className="text-destructive">*</span></Label>
                        <Input
                            placeholder="e.g., Board of Directors Election 2026"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Description</Label>
                        <Textarea
                            rows={3}
                            placeholder="Provide context about this voting event"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                    </div>
                </div>
            ),
        },
        {
            num: 3,
            title: 'Timeline',
            desc: 'Set the voting window',
            content: (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    {([
                        {
                            label: 'Start',
                            date: startDate,
                            setDate: setStartDate,
                            time: startTime,
                            setTime: setStartTime
                        },
                        {label: 'End', date: endDate, setDate: setEndDate, time: endTime, setTime: setEndTime},
                    ] as any[]).map(({label, date, setDate, time, setTime}) => (
                        <div key={label} className="space-y-3">
                            <Label>{label} <span className="text-destructive">*</span></Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-full justify-start text-sm">
                                        <CalendarIcon className="h-4 w-4 mr-2"/>
                                        {date ? format(date, 'PPP') : 'Pick a date'}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar mode="single" selected={date} onSelect={setDate}/>
                                </PopoverContent>
                            </Popover>
                            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)}/>
                        </div>
                    ))}
                </div>
            ),
        },
        {
            num: 4,
            title: 'Candidates',
            desc: 'Minimum 2 required',
            content: <CandidateEditor candidates={candidates} onChange={setCandidates}/>,
        },
        {
            num: 5,
            title: 'Options',
            desc: 'Visibility and result settings',
            content: <EventOptions value={options} onChange={setOptions}/>,
        },
    ];

    return (
        <div className="space-y-5">
            {steps.map(({num, title: stepTitle, desc, content}) => (
                <Card key={num}>
                    <CardHeader className="pb-3">
                        <div className="flex items-center gap-2.5">
                            <div
                                className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-semibold shrink-0">
                                {num}
                            </div>
                            <div>
                                <CardTitle className="text-base">{stepTitle}</CardTitle>
                                <CardDescription className="text-xs mt-0.5">{desc}</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>{content}</CardContent>
                </Card>
            ))}

            <div className="flex justify-end pb-4">
                <Button
                    size="lg"
                    onClick={handlePublish}
                    disabled={submitting || (!lockedOrg && orgs.length === 0)}
                    className="px-8"
                >
                    {submitting ? 'Publishing…' : 'Publish Event'}
                    {!submitting && <ChevronRight className="h-4 w-4 ml-2"/>}
                </Button>
            </div>
        </div>
    );
}

// ─── Main View ────────────────────────────────────────────────────────────────
export function formatEventTime(start: any, end: any) {
    if (!start || !end) return '—';

    const s = new Date(start);
    const e = new Date(end);

    if (!isValid(s) || !isValid(e)) return '—';

    // Same day → compact
    if (isSameDay(s, e)) {
        return `${format(s, 'MMM d · h:mm a')} – ${format(e, 'h:mm a')}`;
    }

    // Same year → drop year (cleaner UI)
    if (isSameYear(s, e)) {
        return `${format(s, 'MMM d · h:mm a')} → ${format(e, 'MMM d · h:mm a')}`;
    }

    // Different year → show full
    return `${format(s, 'MMM d, yyyy · h:mm a')} → ${format(e, 'MMM d, yyyy · h:mm a')}`;
}

export function ManageEventsView() {
    const {orgs, setOrgs, events, setEvents, session} = useAppContext();
    const [orgsLoading, setOrgsLoading] = useState(false);
    const [editTarget, setEditTarget] = useState<VotingEvent | null>(null);

    const isUnified = session?.type === 'UNIFIED';
    const isOrg = session?.type === 'ORG';
    const isGov = session?.type === 'GOV';

    const loadOrgs = useCallback(async () => {
        setOrgsLoading(true);
        try {
            const data = await api.getMyOrgs();
            // ORG session: only keep the session org (avoids leaking other org data)
            setOrgs(isOrg ? data.filter((o) => o.orgid === session?.orgid) : data);
        } catch {
            toast.error('Failed to load your organisations');
        } finally {
            setOrgsLoading(false);
        }
    }, [setOrgs, isOrg, session?.orgid]);

    const refreshEvents = useCallback(async () => {
        try {
            setEvents(await api.getEvents());
        } catch { /* silent */
        }
    }, [setEvents]);

    useEffect(() => {
        if (isGov) return;                          // GOV has no org events to manage
        if (orgs.length === 0) loadOrgs();
        refreshEvents();
    }, []);

    // The single org this ORG session can act as (resolved from loaded orgs)
    const sessionOrg = isOrg
        ? orgs.find((o) => o.orgid === session?.orgid) ?? null
        : null;

    const managedEventCount = [...events.active_pending, ...events.completed, ...events.voted]
        .filter((e) => orgs.some((o) => o.orgid === e.orgid)).length;

    const liveCount = [...events.active_pending, ...events.voted]
        .filter((e) => orgs.some((o) => o.orgid === e.orgid) && !isFuture(new Date(e.start_time))).length;

    // GOV sessions have no event management access
    if (isGov) {
        return (
            <div className="max-w-4xl mx-auto space-y-6">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Manage Events</h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        Create and manage voting events for your organisations
                    </p>
                </div>
                <Card>
                    <CardContent className="py-10 text-center space-y-2">
                        <p className="font-semibold">Not available</p>
                        <p className="text-sm text-muted-foreground">
                            Event management requires a Unified or Organization session.
                        </p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Manage Events</h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        {isOrg && sessionOrg
                            ? `Managing events for ${sessionOrg.org_name}`
                            : 'Create and manage voting events for your organisations'}
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                        loadOrgs();
                        refreshEvents();
                    }}
                    disabled={orgsLoading}
                    className="shrink-0"
                >
                    <RefreshCw className={`h-4 w-4 mr-2 ${orgsLoading ? 'animate-spin' : ''}`}/>
                    Refresh
                </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
                {([
                    {label: 'Managed orgs', value: orgsLoading ? '—' : orgs.filter((o) => o.is_active).length},
                    {label: 'Your events', value: managedEventCount},
                    {label: 'Live now', value: liveCount},
                ] as { label: string; value: number | string }[]).map(({label, value}) => (
                    <Card key={label} className="py-4 px-5">
                        <p className="text-2xl font-bold">{value}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                    </Card>
                ))}
            </div>

            {orgs.length === 0 && !orgsLoading && (
                <div
                    className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-4 py-3">
                    <AlertCircle className="h-4 w-4 shrink-0"/>
                    You don't have organizer access in any organisation. Contact your org admin.
                </div>
            )}

            {/* Tabs */}
            <Tabs defaultValue="create">
                <TabsList className="h-9">
                    <TabsTrigger value="create" className="text-sm">Create Event</TabsTrigger>
                    <TabsTrigger value="manage" className="text-sm">
                        My Events
                        {managedEventCount > 0 && (
                            <span
                                className="ml-2 bg-muted text-muted-foreground text-xs rounded-full px-1.5 py-0.5 leading-none">
                                {managedEventCount}
                            </span>
                        )}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="create" className="mt-5">
                    {orgsLoading ? (
                        <div className="space-y-5">
                            {[1, 2, 3].map((i) => (
                                <Card key={i}>
                                    <CardHeader><Skeleton className="h-5 w-40"/></CardHeader>
                                    <CardContent><Skeleton className="h-9 w-full"/></CardContent>
                                </Card>
                            ))}
                        </div>
                    ) : (
                        <CreateEventForm
                            orgs={orgs.filter((o) => o.is_active)}
                            onCreated={refreshEvents}
                            lockedOrg={sessionOrg ?? undefined}   // ← auto-selects + hides dropdown for ORG session
                        />
                    )}
                </TabsContent>

                <TabsContent value="manage" className="mt-5">
                    <MyEventsList orgs={orgs} onEdit={setEditTarget} onDeleted={refreshEvents}/>
                </TabsContent>
            </Tabs>

            {/* Edit Sheet */}
            <EditEventSheet
                event={editTarget}
                onClose={() => setEditTarget(null)}
                onSaved={() => {
                    setEditTarget(null);
                    refreshEvents();
                }}
            />
        </div>
    );
}