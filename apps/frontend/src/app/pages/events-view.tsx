import { useState, useEffect } from 'react';
import { useAppContext, VotingEvent, Candidate } from '../context/app-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { Label } from '../components/ui/label';
import { Calendar, MapPin, Vote, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
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
import { ImageWithFallback } from '../components/figma/ImageWithFallback';
import { toast } from 'sonner';

export function EventsView() {
  const { events, addEvent, voteOnEvent } = useAppContext();
  const [selectedEvent, setSelectedEvent] = useState<VotingEvent | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<string>('');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Initialize with mock data
  useEffect(() => {
    if (events.length === 0) {
      const mockEvents: VotingEvent[] = [
        {
          id: '1',
          title: 'City Council Election 2026',
          description:
            'Annual city council election to elect representatives for the upcoming term. Your vote matters in shaping our community.',
          organizer: 'City Electoral Commission',
          organizationId: 'GOV-001',
          scopeLevel: 0,
          startDate: new Date('2026-03-15T08:00:00'),
          endDate: new Date('2026-03-15T20:00:00'),
          status: 'active',
          enableLiveData: true,
          restrictVisibility: false,
          userVoted: false,
          candidates: [
            {
              id: 'c1',
              name: 'Sarah Johnson',
              bio: 'Former business executive with 15 years of public service experience',
              imageUrl:
                'https://images.unsplash.com/photo-1770363757711-aa4db84d308d?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx3b21hbiUyMHByb2Zlc3Npb25hbCUyMHBvcnRyYWl0JTIwY29uZmlkZW50fGVufDF8fHx8MTc3MzIzNzIzM3ww&ixlib=rb-4.1.0&q=80&w=1080',
            },
            {
              id: 'c2',
              name: 'Michael Chen',
              bio: 'Community organizer focused on sustainable development',
              imageUrl:
                'https://images.unsplash.com/photo-1758691737644-ef8be18256c3?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxidXNpbmVzcyUyMGxlYWRlciUyMHByb2Zlc3Npb25hbCUyMGhlYWRzaG90fGVufDF8fHx8MTc3MzE5NjUwN3ww&ixlib=rb-4.1.0&q=80&w=1080',
            },
            {
              id: 'c3',
              name: 'Robert Williams',
              bio: 'Former mayor with proven track record in urban planning',
              imageUrl:
                'https://images.unsplash.com/photo-1729219330287-a914170ca5ee?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxwb2xpdGljYWwlMjBjYW5kaWRhdGUlMjBwb3J0cmFpdCUyMHByb2Zlc3Npb25hbHxlbnwxfHx8fDE3NzMyMzcyMzN8MA&ixlib=rb-4.1.0&q=80&w=1080',
            },
          ],
          votes: { c1: 0, c2: 0, c3: 0 },
        },
        {
          id: '2',
          title: 'Board of Directors Election',
          description: 'Annual election for company board of directors',
          organizer: 'TechCorp HR',
          organizationId: 'TECH-001',
          scopeLevel: 0,
          startDate: new Date('2026-04-01T09:00:00'),
          endDate: new Date('2026-04-01T17:00:00'),
          status: 'active',
          enableLiveData: false,
          restrictVisibility: true,
          userVoted: false,
          candidates: [
            {
              id: 'c4',
              name: 'Jennifer Martinez',
              bio: 'VP of Operations with 20 years industry experience',
            },
            {
              id: 'c5',
              name: 'David Kim',
              bio: 'Chief Technology Officer and innovation leader',
            },
          ],
          votes: { c4: 0, c5: 0 },
        },
      ];

      mockEvents.forEach((event) => addEvent(event));
    }
  }, []);

  const activeEvents = events.filter((e) => e.status === 'active' && !e.userVoted);
  const votedEvents = events.filter((e) => e.userVoted);
  const completedEvents = events.filter((e) => e.status === 'completed');

  const handleVoteNow = (event: VotingEvent) => {
    setSelectedEvent(event);
    setSelectedCandidate('');
  };

  const handleConfirmVote = () => {
    if (!selectedCandidate || !selectedEvent) return;
    setShowConfirmDialog(true);
  };

  const handleSubmitVote = () => {
    if (!selectedEvent || !selectedCandidate) return;
    voteOnEvent(selectedEvent.id, selectedCandidate);
    setShowConfirmDialog(false);
    setSelectedEvent(null);
    setSelectedCandidate('');
    toast.success('Vote submitted successfully!');
  };

  const EventCard = ({ event }: { event: VotingEvent }) => (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="mb-2">{event.title}</CardTitle>
            <CardDescription className="line-clamp-2">{event.description}</CardDescription>
          </div>
          {event.enableLiveData && (
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
              Live
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <MapPin className="h-4 w-4" />
            <span>{event.organizer}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>
              {format(event.startDate, 'MMM dd, yyyy')} • {format(event.startDate, 'hh:mm a')} -{' '}
              {format(event.endDate, 'hh:mm a')}
            </span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Vote className="h-4 w-4" />
            <span>Scope Level {event.scopeLevel}</span>
          </div>
        </div>

        {event.status === 'active' && !event.userVoted && (
          <Button className="w-full" onClick={() => handleVoteNow(event)}>
            Vote Now
          </Button>
        )}

        {event.userVoted && (
          <div className="flex items-center gap-2 text-green-600 justify-center py-2">
            <CheckCircle2 className="h-5 w-5" />
            <span>You have voted in this event</span>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="mb-2">My Voting Events</h1>
        <p className="text-muted-foreground">
          View and participate in voting events you're eligible for
        </p>
      </div>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">
            Active ({activeEvents.length})
          </TabsTrigger>
          <TabsTrigger value="voted">
            Voted ({votedEvents.length})
          </TabsTrigger>
          <TabsTrigger value="completed">
            Completed ({completedEvents.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-6">
          {activeEvents.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No active voting events at the moment
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {activeEvents.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="voted" className="mt-6">
          {votedEvents.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                You haven't voted in any events yet
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {votedEvents.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="completed" className="mt-6">
          {completedEvents.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No completed events
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {completedEvents.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Voting Sheet */}
      <Sheet open={!!selectedEvent} onOpenChange={() => setSelectedEvent(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          {selectedEvent && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedEvent.title}</SheetTitle>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <div>
                  <h3 className="mb-2">Event Description</h3>
                  <p className="text-muted-foreground">{selectedEvent.description}</p>
                </div>

                <div>
                  <h3 className="mb-4">Select a Candidate</h3>
                  <RadioGroup value={selectedCandidate} onValueChange={setSelectedCandidate}>
                    <div className="space-y-4">
                      {selectedEvent.candidates.map((candidate) => (
                        <Card
                          key={candidate.id}
                          className={`cursor-pointer transition-all ${
                            selectedCandidate === candidate.id
                              ? 'border-[#1e40af] bg-blue-50'
                              : 'hover:border-gray-300'
                          }`}
                          onClick={() => setSelectedCandidate(candidate.id)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start gap-4">
                              <RadioGroupItem value={candidate.id} id={candidate.id} />
                              {candidate.imageUrl && (
                                <ImageWithFallback
                                  src={candidate.imageUrl}
                                  alt={candidate.name}
                                  className="w-16 h-16 rounded-full object-cover"
                                />
                              )}
                              <div className="flex-1">
                                <Label
                                  htmlFor={candidate.id}
                                  className="cursor-pointer text-base"
                                >
                                  {candidate.name}
                                </Label>
                                {candidate.bio && (
                                  <p className="text-sm text-muted-foreground mt-1">
                                    {candidate.bio}
                                  </p>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </RadioGroup>
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setSelectedEvent(null)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleConfirmVote}
                    disabled={!selectedCandidate}
                    className="flex-1"
                  >
                    Confirm Vote
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Your Vote</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to cast your vote for{' '}
              <strong>
                {selectedEvent?.candidates.find((c) => c.id === selectedCandidate)?.name}
              </strong>{' '}
              in {selectedEvent?.title}. This action cannot be undone. Are you sure you want to
              proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go Back</AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmitVote}>Submit Vote</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
