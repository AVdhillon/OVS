import { useState } from 'react';
import { useAppContext, Candidate } from '../context/app-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { Plus, X, Calendar as CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Calendar } from '../components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { format } from 'date-fns';

export function ManageEventsView() {
  const { addEvent, identities, organizations } = useAppContext();

  const [selectedIdentity, setSelectedIdentity] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [enableLiveData, setEnableLiveData] = useState(true);
  const [restrictVisibility, setRestrictVisibility] = useState(false);

  const [newCandidateName, setNewCandidateName] = useState('');
  const [newCandidateBio, setNewCandidateBio] = useState('');

  const handleAddCandidate = () => {
    if (!newCandidateName.trim()) return;

    const newCandidate: Candidate = {
      id: `c-${Date.now()}`,
      name: newCandidateName,
      bio: newCandidateBio,
    };

    setCandidates([...candidates, newCandidate]);
    setNewCandidateName('');
    setNewCandidateBio('');
  };

  const handleRemoveCandidate = (id: string) => {
    setCandidates(candidates.filter((c) => c.id !== id));
  };

  const handlePublishEvent = () => {
    if (!title || !description || !startDate || !endDate || candidates.length === 0) {
      toast.error('Please fill in all required fields');
      return;
    }

    const [startHour, startMinute] = startTime.split(':');
    const [endHour, endMinute] = endTime.split(':');

    const eventStartDate = new Date(startDate);
    eventStartDate.setHours(parseInt(startHour), parseInt(startMinute));

    const eventEndDate = new Date(endDate);
    eventEndDate.setHours(parseInt(endHour), parseInt(endMinute));

    const newEvent = {
      id: `evt-${Date.now()}`,
      title,
      description,
      organizer: identities.find((id) => id.id === selectedIdentity)?.displayName || 'Unknown',
      organizationId: selectedIdentity || 'PERSONAL',
      scopeLevel: 0,
      startDate: eventStartDate,
      endDate: eventEndDate,
      candidates: candidates.map((c) => ({ ...c })),
      enableLiveData,
      restrictVisibility,
      status: 'active' as const,
      userVoted: false,
      votes: candidates.reduce((acc, c) => ({ ...acc, [c.id]: 0 }), {}),
    };

    addEvent(newEvent);
    toast.success('Event published successfully!');

    // Reset form
    setTitle('');
    setDescription('');
    setStartDate(undefined);
    setEndDate(undefined);
    setCandidates([]);
    setEnableLiveData(true);
    setRestrictVisibility(false);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="mb-2">Manage My Events</h1>
        <p className="text-muted-foreground">Create and manage voting events</p>
      </div>

      <div className="space-y-6">
        {/* Step 1: Context Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Step 1: Context Selection</CardTitle>
            <CardDescription>Select the identity to create this event as</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="identity">
                Create As <span className="text-destructive">*</span>
              </Label>
              <Select value={selectedIdentity} onValueChange={setSelectedIdentity}>
                <SelectTrigger id="identity">
                  <SelectValue placeholder="Select an identity" />
                </SelectTrigger>
                <SelectContent>
                  {identities.map((identity) => (
                    <SelectItem key={identity.id} value={identity.id}>
                      {identity.displayName} ({identity.type})
                    </SelectItem>
                  ))}
                  {organizations.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name} (Organization)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Step 2: Event Details */}
        <Card>
          <CardHeader>
            <CardTitle>Step 2: Event Details</CardTitle>
            <CardDescription>Provide basic information about the event</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">
                Event Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="title"
                placeholder="e.g., Board of Directors Election 2026"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">
                Description <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="description"
                placeholder="Provide a detailed description of the voting event"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Step 3: Timeline */}
        <Card>
          <CardHeader>
            <CardTitle>Step 3: Timeline</CardTitle>
            <CardDescription>Set the voting period</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  Start Date <span className="text-destructive">*</span>
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {startDate ? format(startDate, 'PPP') : 'Pick a date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={startDate} onSelect={setStartDate} />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label htmlFor="startTime">Start Time</Label>
                <Input
                  id="startTime"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  End Date <span className="text-destructive">*</span>
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {endDate ? format(endDate, 'PPP') : 'Pick a date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={endDate} onSelect={setEndDate} />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label htmlFor="endTime">End Time</Label>
                <Input
                  id="endTime"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Step 4: Candidates */}
        <Card>
          <CardHeader>
            <CardTitle>Step 4: Candidates</CardTitle>
            <CardDescription>
              Add candidates for this voting event (minimum 1 required)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="candidateName">Candidate Name</Label>
                <Input
                  id="candidateName"
                  placeholder="Full name"
                  value={newCandidateName}
                  onChange={(e) => setNewCandidateName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="candidateBio">Bio (Optional)</Label>
                <Textarea
                  id="candidateBio"
                  placeholder="Brief biography or description"
                  rows={2}
                  value={newCandidateBio}
                  onChange={(e) => setNewCandidateBio(e.target.value)}
                />
              </div>
              <Button onClick={handleAddCandidate} variant="outline" className="w-full">
                <Plus className="mr-2 h-4 w-4" />
                Add Candidate
              </Button>
            </div>

            {candidates.length > 0 && (
              <div className="mt-4 space-y-2">
                <Label>Added Candidates ({candidates.length})</Label>
                <div className="space-y-2">
                  {candidates.map((candidate) => (
                    <div
                      key={candidate.id}
                      className="flex items-start justify-between p-3 border rounded-lg bg-gray-50"
                    >
                      <div className="flex-1">
                        <p>{candidate.name}</p>
                        {candidate.bio && (
                          <p className="text-sm text-muted-foreground mt-1">{candidate.bio}</p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveCandidate(candidate.id)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 5: Advanced Options */}
        <Card>
          <CardHeader>
            <CardTitle>Step 5: Advanced Options</CardTitle>
            <CardDescription>Configure additional event settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="liveData">Enable Live Vote Data</Label>
                <p className="text-sm text-muted-foreground">
                  Display real-time voting results to participants
                </p>
              </div>
              <Switch
                id="liveData"
                checked={enableLiveData}
                onCheckedChange={setEnableLiveData}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="visibility">Restrict Visibility to Current Scope</Label>
                <p className="text-sm text-muted-foreground">
                  Only users in the current organizational scope can see this event
                </p>
              </div>
              <Switch
                id="visibility"
                checked={restrictVisibility}
                onCheckedChange={setRestrictVisibility}
              />
            </div>
          </CardContent>
        </Card>

        {/* Publish Button */}
        <div className="flex justify-end">
          <Button onClick={handlePublishEvent} size="lg" className="px-8">
            Publish Event
          </Button>
        </div>
      </div>
    </div>
  );
}
