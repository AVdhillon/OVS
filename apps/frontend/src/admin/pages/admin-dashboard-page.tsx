import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../app/components/ui/card";
import { Button } from "../../app/components/ui/button";
import { Badge } from "../../app/components/ui/badge";
import { AdminHeader } from "../components/admin-header";
import { useAdminContext } from "../context/admin-context";
import { Link } from "react-router";
import { Inbox } from "lucide-react";

// EDIT (Phase 1 — auth model consolidation, subphase 1.10): originally a
// placeholder proving login -> session -> protected-route works, with its
// own inline logo/nav/sign-out header.
//
// EDIT (Phase 3 — admin portal core, subphase 3.5): switched to the new
// shared AdminHeader (see src/admin/components/admin-header.tsx) instead
// of the inline header this page used to carry, so the header doesn't
// silently drift from the request-queue/detail pages this subphase also
// adds. Replaced the "lands in Phase 3" placeholder line with a real card
// linking into the request queue — this page is still intentionally thin;
// 3.6's org-directory link is expected to land here the same way once it
// exists.
export function AdminDashboardPage() {
  const { admin } = useAdminContext();

  return (
    <div className="min-h-screen bg-muted/30">
      <AdminHeader />
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Signed in</CardTitle>
            <CardDescription>
              Admin session established via /auth/admin-login.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Admin ID:</span>
              <span className="font-medium">{admin?.admin_id}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Role:</span>
              <Badge variant={admin?.is_super_admin ? "default" : "secondary"}>
                {admin?.is_super_admin ? "Super admin" : "Admin"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="size-4" />
              Org requests
            </CardTitle>
            <CardDescription>
              Review pending organization requests — approve, reject, or ask
              for more information.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/requests">Open request queue</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
