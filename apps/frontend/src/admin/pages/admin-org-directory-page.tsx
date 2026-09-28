import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../app/components/ui/card";
import { Badge } from "../../app/components/ui/badge";
import { Button } from "../../app/components/ui/button";
import { Input } from "../../app/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../../app/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "../../app/components/ui/tabs";
import { AdminHeader } from "../components/admin-header";
import { adminApi, type OrgListItem, type OrgStatus } from "../lib/admin-api";
import { ChevronLeft, ChevronRight, Building2, Search } from "lucide-react";

// Reads GET /admin/organizations — a landscape view, not a review queue, so
// unlike admin-request-queue-page.tsx's "Open" tab this page's "All" tab is
// the one that sends no `status` param, mirroring OrgDirectoryService.list()'s
// own default-shows-everything reasoning (see that method's comment) rather
// than re-deciding a default here.
const PAGE_SIZE = 25;

const STATUS_TABS: Array<{ key: string; label: string; status?: OrgStatus[] }> = [
  { key: "all", label: "All" }, // no status param — backend's own show-everything default
  { key: "active", label: "Active", status: ["ACTIVE"] },
  { key: "suspended", label: "Suspended", status: ["SUSPENDED"] },
  { key: "archived", label: "Archived", status: ["ARCHIVED"] },
];

const STATUS_BADGE: Record<OrgStatus, { label: string; className: string }> = {
  ACTIVE: {
    label: "Active",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  SUSPENDED: {
    label: "Suspended",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  ARCHIVED: {
    label: "Archived",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function AdminOrgDirectoryPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [orgs, setOrgs] = useState<OrgListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeTab = STATUS_TABS.find((t) => t.key === tab) ?? STATUS_TABS[0];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.listOrganizations({
        status: activeTab.status,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setOrgs(res.organizations);
      setTotal(res.total);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load organizations");
      setOrgs([]);
    } finally {
      setLoading(false);
    }
    // activeTab is derived from `tab`, which IS in the dep array — same
    // reasoning as admin-request-queue-page.tsx's own load().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  const handleTabChange = (next: string) => {
    setTab(next);
    setPage(1); // switching tabs resets pagination
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1); // a new search resets pagination
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-muted/30">
      <AdminHeader />
      <div className="mx-auto max-w-6xl space-y-4 p-6">
        <div>
          <h1 className="text-xl font-semibold">Organizations</h1>
          <p className="text-sm text-muted-foreground">
            The full landscape of registered organizations, by status.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={tab} onValueChange={handleTabChange}>
            <TabsList>
              {STATUS_TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <form
            onSubmit={handleSearchSubmit}
            className="flex items-center gap-2"
          >
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by name or orgid..."
                className="w-64 pl-8"
              />
            </div>
            <Button type="submit" variant="outline" size="sm">
              Search
            </Button>
          </form>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {activeTab.label} organizations
              {total > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({total})
                </span>
              )}
            </CardTitle>
            <CardDescription>
              {search
                ? `Matching "${search}"`
                : "Most recently registered first."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <p className="mb-4 text-sm text-destructive">{error}</p>
            )}

            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Loading...
              </p>
            ) : !orgs || orgs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                <Building2 className="size-8" />
                <p className="text-sm">No organizations in this view.</p>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Organization</TableHead>
                      <TableHead>Org ID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Members</TableHead>
                      <TableHead>Events</TableHead>
                      <TableHead>Registered</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orgs.map((org) => (
                      <TableRow
                        key={org.orgid}
                        className="cursor-pointer"
                        onClick={() => navigate(`/organizations/${org.orgid}`)}
                      >
                        <TableCell className="font-medium">
                          {org.org_name}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {org.orgid}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={STATUS_BADGE[org.status].className}
                          >
                            {STATUS_BADGE[org.status].label}
                          </Badge>
                        </TableCell>
                        <TableCell>{org.member_count}</TableCell>
                        <TableCell>
                          {org.events.active} active
                          {org.events.total > org.events.active && (
                            <span className="text-muted-foreground">
                              {" "}
                              / {org.events.total} total
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(org.created_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Page {page} of {totalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="mr-1 size-4" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() =>
                          setPage((p) => Math.min(totalPages, p + 1))
                        }
                      >
                        Next
                        <ChevronRight className="ml-1 size-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
