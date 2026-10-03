import { useState, useEffect, useCallback, useRef } from "react";
import { useAppContext, VotingEvent } from "../context/app-context";
import { api } from "../../lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui/tabs";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "../components/ui/sheet";
import { RadioGroup, RadioGroupItem } from "../components/ui/radio-group";
import { Label } from "../components/ui/label";
import { Skeleton } from "../components/ui/skeleton";
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
  Calendar,
  Clock,
  Vote,
  CheckCircle2,
  BarChart3,
  Building2,
  AlertCircle,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import { format, formatDistanceToNow, isPast, isFuture } from "date-fns";
import { toast } from "sonner";
import { formatEventTime } from "./manage-events-view";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getEventStatus(
  event: VotingEvent,
): "upcoming" | "active" | "ended" | "cancelled" {
  if (event.status === "CANCELLED") return "cancelled";
  if (event.status === "COMPLETED") return "ended";
  const now = new Date();
  const start = new Date(event.start_time);
  const end = new Date(event.end_time);
  if (isFuture(start)) return "upcoming";
  if (isPast(end)) return "ended";
  return "active";
}

function StatusBadge({ event }: { event: VotingEvent }) {
  const s = getEventStatus(event);
  const map = {
    upcoming: "bg-amber-50 text-amber-700 border-amber-200",
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    ended: "bg-slate-100 text-slate-600 border-slate-200",
    cancelled: "bg-red-50 text-red-600 border-red-200",
  };
  const label = {
    upcoming: "Upcoming",
    active: "Live",
    ended: "Ended",
    cancelled: "Cancelled",
  };
  return (
    <Badge variant="outline" className={`text-xs font-medium ${map[s]}`}>
      {s === "active" && (
        <span className="mr-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      )}
      {label[s]}
    </Badge>
  );
}

function TimeInfo({ event }: { event: VotingEvent }) {
  const start = new Date(event.start_time);
  const end = new Date(event.end_time);
  const s = getEventStatus(event);

  if (s === "active") {
    return (
      <span className="text-xs text-emerald-600 font-medium">
        Closes {formatDistanceToNow(end, { addSuffix: true })}
      </span>
    );
  }
  if (s === "upcoming") {
    return (
      <span className="text-xs text-amber-600 font-medium">
        Opens {formatDistanceToNow(start, { addSuffix: true })}
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground">
      {format(start, "MMM d, yyyy")}
    </span>
  );
}

// ─── Results Bar ──────────────────────────────────────────────────────────────

function ResultsDisplay({ event }: { event: VotingEvent }) {
  if (!event.results || event.results.length === 0) return null;

  const maxVotes = Math.max(...event.results.map((r) => r.vote_count), 1);
  const total = event.results.reduce((sum, r) => sum + r.vote_count, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Results</p>
        <span className="text-xs text-muted-foreground">
          {total} total votes
        </span>
      </div>
      {event.results.map((r) => (
        <div key={r.candidate_id} className="space-y-1">
          <div className="flex justify-between items-center text-sm">
            <span className="font-medium truncate">{r.candidate_name}</span>
            <span className="text-muted-foreground ml-2 shrink-0">
              {r.percentage.toFixed(1)}%
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-700"
              style={{ width: `${(r.vote_count / maxVotes) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Event Card ───────────────────────────────────────────────────────────────

interface EventCardProps {
  event: VotingEvent;
  onVote: (event: VotingEvent) => void;
  onViewResults: (event: VotingEvent) => void;
}

function EventCard({ event, onVote, onViewResults }: EventCardProps) {
  const s = getEventStatus(event);
  const showResults =
    event.has_voted ||
    s === "ended" ||
    (s === "active" && event.show_live_results);

  return (
    <Card className="group flex flex-col hover:shadow-md transition-all duration-200 border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <StatusBadge event={event} />
          <TimeInfo event={event} />
        </div>
        <CardTitle className="text-base leading-snug mt-2 group-hover:text-primary transition-colors">
          {event.title}
        </CardTitle>
        {event.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
            {event.description}
          </p>
        )}
      </CardHeader>

      <CardContent className="flex flex-col flex-1 gap-4 pt-0">
        {/* Meta */}
        <div className="space-y-1.5 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            <span className="font-mono text-xs">{event.orgid}</span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 shrink-0" />
            <span>{formatEventTime(event.start_time, event.end_time)}</span>
          </div>
          {event.candidates && (
            <div className="flex items-center gap-2">
              <Vote className="h-3.5 w-3.5 shrink-0" />
              <span>{event.candidates.length} candidates</span>
            </div>
          )}
        </div>

        {/* Results preview (inline for voted/completed with live results) */}
        {showResults && event.results && event.results.length > 0 && (
          <ResultsDisplay event={event} />
        )}

        {/* Actions */}
        <div className="mt-auto pt-1">
          {s === "active" && !event.has_voted && (
            <Button className="w-full" size="sm" onClick={() => onVote(event)}>
              <Vote className="h-4 w-4 mr-2" />
              Cast Vote
            </Button>
          )}

          {event.has_voted && (
            <div
              role="status"
              className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2"
            >
              <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>You voted ✓</span>
              </div>
              {showResults && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => onViewResults(event)}
                >
                  Full results <ChevronRight className="h-3 w-3" />
                </Button>
              )}
            </div>
          )}

          {(s === "ended" || s === "cancelled") && !event.has_voted && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {s === "cancelled" ? "Event cancelled" : "Voting closed"}
              </span>
              {s === "ended" && event.results && event.results.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => onViewResults(event)}
                >
                  <BarChart3 className="h-3 w-3" /> Results
                </Button>
              )}
            </div>
          )}

          {s === "upcoming" && (
            <p className="text-xs text-center text-muted-foreground py-1">
              Voting not yet open
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-16 flex flex-col items-center gap-3 text-muted-foreground">
        <Vote className="h-8 w-8 opacity-30" />
        <p className="text-sm">{message}</p>
      </CardContent>
    </Card>
  );
}

// ─── Skeleton Cards ───────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <Card>
      <CardHeader className="space-y-2 pb-3">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-8 w-full mt-2" />
      </CardContent>
    </Card>
  );
}

// ─── Grid ─────────────────────────────────────────────────────────────────────

const EVENTS_PAGE_SIZE = 12;

function EventGrid({
  events,
  emptyMsg,
  onVote,
  onViewResults,
  loading,
}: {
  events: VotingEvent[];
  emptyMsg: string;
  onVote: (e: VotingEvent) => void;
  onViewResults: (e: VotingEvent) => void;
  loading: boolean;
}) {
  // Completed / Voted only ever grow, so render them a page at a time.
  const [visibleCount, setVisibleCount] = useState(EVENTS_PAGE_SIZE);
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {[1, 2, 3].map((i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (events.length === 0) return <EmptyState message={emptyMsg} />;
  const shown = events.slice(0, visibleCount);
  const remaining = events.length - shown.length;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {shown.map((event) => (
          <EventCard
            key={event.event_id}
            event={event}
            onVote={onVote}
            onViewResults={onViewResults}
          />
        ))}
      </div>
      {remaining > 0 && (
        <div className="flex flex-col items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVisibleCount((n) => n + EVENTS_PAGE_SIZE)}
          >
            Show more
          </Button>
          <p className="text-xs text-muted-foreground tabular-nums">
            Showing {shown.length} of {events.length}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function EventsView() {
  // UNIFIED and ORG sessions (the only types that ever load this app, see
  // app-context.tsx's SessionType note) can both vote, so there's no
  // gating needed here.
  const { events, setEvents, updateEventInList } = useAppContext();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Vote sheet state
  const [sheetEvent, setSheetEvent] = useState<VotingEvent | null>(null);
  const [sheetMode, setSheetMode] = useState<"vote" | "results">("vote");
  const [sheetLoading, setSheetLoading] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<number | null>(
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous guard: state updates are async, so a fast double-tap could
  // otherwise fire two requests before `submitting` re-renders as true.
  const submitLockRef = useRef(false);

  const filterVoterOnly = (list: VotingEvent[]) =>
    list.filter((e) => e.is_voter);

  // ── Load events ──────────────────────────────────────────────────────────────

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getEvents();
      setEvents(data);
    } catch (e: any) {
      setError(e.message ?? "Failed to load events");
    } finally {
      setLoading(false);
    }
  }, [setEvents]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // ── Open vote sheet (fetch full event with candidates) ────────────────────

  const handleVote = async (event: VotingEvent) => {
    setSheetMode("vote");
    setSelectedCandidate(null);
    setSheetEvent(event);

    if (!event.candidates || event.candidates.length === 0) {
      setSheetLoading(true);
      try {
        const full = await api.getEvent(event.event_id);
        setSheetEvent(full);
      } catch {
        toast.error("Failed to load event details");
      } finally {
        setSheetLoading(false);
      }
    }
  };

  // ── Open results sheet ────────────────────────────────────────────────────

  const handleViewResults = async (event: VotingEvent) => {
    setSheetMode("results");
    setSheetEvent(event);

    // Fetch fresh results if not available
    if (!event.results || event.results.length === 0) {
      setSheetLoading(true);
      try {
        const results = await api.getResults(event.event_id);
        const updated = { ...event, results: results.results };
        setSheetEvent(updated);
        updateEventInList(event.event_id, { results: results.results });
      } catch (e: any) {
        toast.error(e.message ?? "Results not available yet");
      } finally {
        setSheetLoading(false);
      }
    }
  };

  // ── Submit vote ───────────────────────────────────────────────────────────

  const handleSubmitVote = async () => {
    if (!sheetEvent || selectedCandidate === null) return;
    if (submitLockRef.current) return;
    submitLockRef.current = true;

    setSubmitting(true);
    try {
      const res = await api.castVote({
        event_id: sheetEvent.event_id,
        candidate_id: selectedCandidate,
      });

      updateEventInList(sheetEvent.event_id, {
        has_voted: true,
        results: res.live_results ?? sheetEvent.results,
      });

      setConfirmOpen(false);
      setSheetEvent(null);

      toast.success("Your vote has been submitted!");
      await loadEvents();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to submit vote");
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  const selectedCandidateName = sheetEvent?.candidates?.find(
    (c) => c.candidate_id === selectedCandidate,
  )?.candidate_name;

  // ── Render ────────────────────────────────────────────────────────────────
  const activeEvents = filterVoterOnly(events.active_pending);
  const votedEvents = filterVoterOnly(events.voted);
  const completedEvents = filterVoterOnly(events.completed);
  const commonGridProps = {
    onVote: handleVote,
    onViewResults: handleViewResults,
    loading,
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
            My Voting Events
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            View and participate in events you're eligible for
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadEvents}
          disabled={loading}
          className="shrink-0"
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="active">
        <TabsList className="h-9">
          <TabsTrigger value="active" className="text-sm">
            Active
            {activeEvents.length > 0 && (
              <span className="ml-2 bg-primary text-primary-foreground text-xs rounded-full px-1.5 py-0.5 leading-none">
                {activeEvents.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="voted" className="text-sm">
            Voted
            {votedEvents.length > 0 && (
              <span className="ml-2 bg-muted text-muted-foreground text-xs rounded-full px-1.5 py-0.5 leading-none">
                {votedEvents.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="completed" className="text-sm">
            Completed
            {completedEvents.length > 0 && (
              <span className="ml-2 bg-muted text-muted-foreground text-xs rounded-full px-1.5 py-0.5 leading-none">
                {completedEvents.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-5">
          <EventGrid
            events={filterVoterOnly(events.active_pending)}
            emptyMsg="No active or upcoming voting events right now"
            {...commonGridProps}
          />
        </TabsContent>

        <TabsContent value="voted" className="mt-5">
          <EventGrid
            events={filterVoterOnly(events.voted)}
            emptyMsg="You haven't voted in any events yet"
            {...commonGridProps}
          />
        </TabsContent>

        <TabsContent value="completed" className="mt-5">
          <EventGrid
            events={filterVoterOnly(events.completed)}
            emptyMsg="No completed events"
            {...commonGridProps}
          />
        </TabsContent>
      </Tabs>

      {/* ── Vote / Results Sheet ─────────────────────────────────────────────── */}
      <Sheet
        open={!!sheetEvent}
        onOpenChange={(open) => !open && setSheetEvent(null)}
      >
        <SheetContent
          side="right"
          className="w-full max-w-full sm:max-w-lg flex flex-col gap-0 p-0"
        >
          {sheetEvent && (
            <>
              {/* Sheet header */}
              <SheetHeader className="px-4 py-4 sm:px-6 sm:py-5 border-b">
                <div className="flex items-center gap-2 mb-1">
                  <StatusBadge event={sheetEvent} />
                  {sheetMode === "results" && (
                    <Badge variant="outline" className="text-xs">
                      <BarChart3 className="h-3 w-3 mr-1" /> Results
                    </Badge>
                  )}
                </div>
                <SheetTitle className="text-left leading-snug">
                  {sheetEvent.title}
                </SheetTitle>
                {sheetEvent.description && (
                  <SheetDescription className="text-left">
                    {sheetEvent.description}
                  </SheetDescription>
                )}
                <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatEventTime(
                      sheetEvent?.start_time,
                      sheetEvent?.end_time,
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    {sheetEvent.orgid}
                  </span>
                </div>
              </SheetHeader>

              {/* Sheet body */}
              <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 space-y-6">
                {sheetLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 p-4 border rounded-lg"
                      >
                        <Skeleton className="h-4 w-4 rounded-full" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-4 w-1/2" />
                          <Skeleton className="h-3 w-3/4" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : sheetMode === "vote" ? (
                  <>
                    <div>
                      <p className="text-sm font-semibold mb-3">
                        Select a candidate
                      </p>
                      {!sheetEvent.candidates ||
                      sheetEvent.candidates.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No candidates available.
                        </p>
                      ) : (
                        <RadioGroup
                          value={selectedCandidate?.toString() ?? ""}
                          onValueChange={(v) => setSelectedCandidate(Number(v))}
                          className="space-y-3"
                        >
                          {sheetEvent.candidates.map((candidate) => {
                            const isSelected =
                              selectedCandidate === candidate.candidate_id;
                            return (
                              <label
                                key={candidate.candidate_id}
                                htmlFor={`c-${candidate.candidate_id}`}
                                className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-all ${
                                  isSelected
                                    ? "border-primary bg-primary/5 shadow-sm"
                                    : "border-border hover:border-muted-foreground/40"
                                }`}
                              >
                                <RadioGroupItem
                                  value={candidate.candidate_id.toString()}
                                  id={`c-${candidate.candidate_id}`}
                                  className="mt-0.5 shrink-0"
                                />
                                <div>
                                  <p className="text-sm font-medium">
                                    {candidate.candidate_name}
                                  </p>
                                  {candidate.description && (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                      {candidate.description}
                                    </p>
                                  )}
                                </div>
                              </label>
                            );
                          })}
                        </RadioGroup>
                      )}
                    </div>
                  </>
                ) : (
                  /* Results mode */
                  <>
                    {sheetEvent.results && sheetEvent.results.length > 0 ? (
                      <div className="space-y-5">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-muted/50 rounded-lg p-3 text-center">
                            <p className="text-2xl font-bold">
                              {sheetEvent.results.reduce(
                                (s, r) => s + r.vote_count,
                                0,
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Total votes
                            </p>
                          </div>
                          <div className="bg-muted/50 rounded-lg p-3 text-center">
                            <p className="text-2xl font-bold">
                              {sheetEvent.candidates?.length ??
                                sheetEvent.results.length}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Candidates
                            </p>
                          </div>
                        </div>

                        <div className="space-y-4">
                          {[...sheetEvent.results]
                            .sort((a, b) => b.vote_count - a.vote_count)
                            .map((r, i) => (
                              <div key={r.candidate_id} className="space-y-1.5">
                                <div className="flex items-center justify-between text-sm">
                                  <div className="flex items-center gap-2 min-w-0">
                                    {i === 0 && (
                                      <span className="text-amber-500 text-xs font-bold">
                                        #1
                                      </span>
                                    )}
                                    <span className="font-medium truncate">
                                      {r.candidate_name}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3 text-muted-foreground shrink-0">
                                    <span className="text-xs">
                                      {r.vote_count} votes
                                    </span>
                                    <span className="font-semibold text-foreground w-12 text-right">
                                      {r.percentage.toFixed(1)}%
                                    </span>
                                  </div>
                                </div>
                                <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-700 ${
                                      i === 0 ? "bg-primary" : "bg-primary/40"
                                    }`}
                                    style={{ width: `${r.percentage}%` }}
                                  />
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        Results are not available yet
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Sheet footer */}
              {sheetMode === "vote" && !sheetLoading && (
                <div className="px-4 py-3 sm:px-6 sm:py-4 border-t flex gap-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                  <Button
                    variant="outline"
                    onClick={() => setSheetEvent(null)}
                    disabled={submitting}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => setConfirmOpen(true)}
                    disabled={selectedCandidate === null || submitting}
                    className="flex-1"
                  >
                    {submitting ? "Submitting…" : "Confirm Vote"}
                  </Button>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Confirm Dialog ────────────────────────────────────────────────────── */}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!submitting) setConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm your vote</AlertDialogTitle>
            <AlertDialogDescription>
              You're about to vote for{" "}
              <strong className="text-foreground">
                {selectedCandidateName}
              </strong>{" "}
              in{" "}
              <strong className="text-foreground">{sheetEvent?.title}</strong>.{" "}
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Go back</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault(); // keep dialog open (and button disabled) until the request finishes
                handleSubmitVote();
              }}
              disabled={submitting}
            >
              {submitting ? "Submitting…" : "Submit vote"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
