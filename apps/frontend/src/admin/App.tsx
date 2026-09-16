import { RouterProvider } from "react-router";
import { adminRouter } from "./routes";
import { AdminProvider } from "./context/admin-context";
import { Toaster } from "../app/components/ui/sonner";

export default function AdminApp() {
  return (
    <AdminProvider>
      <RouterProvider router={adminRouter} />
      <Toaster position="top-right" />
    </AdminProvider>
  );
}
