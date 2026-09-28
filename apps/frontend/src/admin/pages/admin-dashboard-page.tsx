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

// Admin landing page. Uses the shared AdminHeader (see
// src/admin/components/admin-header.tsx) rather than an inline header, so the
// header can't drift from the request-queue and detail pages. The page is
// intentionally thin: it is a set of cards linking into the admin sections.
export function AdminDashboardPage() {
  const { admin } = useAdminContext();

  return (
    <div className="min-h-dvh bg-muted/30">
      <AdminHeader />
      <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
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
