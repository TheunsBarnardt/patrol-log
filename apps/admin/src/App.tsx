import { Navigate, Route, Routes } from "react-router-dom";
import { Layout, RoleHomeRedirect } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ResidentsPage } from "./pages/ResidentsPage";
import { MembersPage } from "./pages/MembersPage";
import { EmergencyServicesPage } from "./pages/EmergencyServicesPage";
import { VehiclesPage } from "./pages/VehiclesPage";
import { PatrolsPage } from "./pages/PatrolsPage";
import { DevicesPage } from "./pages/DevicesPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { LiveMapPage } from "./pages/LiveMapPage";
import { SectorsPage } from "./pages/SectorsPage";
import { MessagingPage } from "./pages/MessagingPage";
import { MyDetailsPage } from "./pages/MyDetailsPage";
import { authStore } from "./lib/api";

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = authStore.getToken();
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

function RequireRoles({
  roles,
  children,
}: {
  roles: Array<"admin" | "sector_lead" | "call_centre_agent" | "patroller">;
  children: JSX.Element;
}) {
  const level = authStore.getProfile()?.access_level;
  if (!level || !roles.includes(level)) return <RoleHomeRedirect />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Layout>
              <Routes>
                <Route
                  index
                  element={
                    <RequireRoles roles={["admin", "sector_lead", "call_centre_agent"]}>
                      <DashboardPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="my-details"
                  element={
                    <RequireRoles roles={["patroller", "admin", "sector_lead", "call_centre_agent"]}>
                      <MyDetailsPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="residents"
                  element={
                    <RequireRoles roles={["admin", "sector_lead", "call_centre_agent"]}>
                      <ResidentsPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="members"
                  element={
                    <RequireRoles roles={["admin", "sector_lead", "call_centre_agent"]}>
                      <MembersPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="emergency-services"
                  element={
                    <RequireRoles roles={["admin", "sector_lead", "call_centre_agent"]}>
                      <EmergencyServicesPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="vehicles"
                  element={
                    <RequireRoles roles={["admin", "sector_lead"]}>
                      <VehiclesPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="patrols"
                  element={
                    <RequireRoles roles={["admin", "sector_lead", "call_centre_agent"]}>
                      <PatrolsPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="devices"
                  element={
                    <RequireRoles roles={["admin", "sector_lead"]}>
                      <DevicesPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="audit-log"
                  element={
                    <RequireRoles roles={["admin", "sector_lead"]}>
                      <AuditLogPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="live-map"
                  element={
                    <RequireRoles roles={["admin", "sector_lead", "call_centre_agent"]}>
                      <LiveMapPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="sectors"
                  element={
                    <RequireRoles roles={["admin"]}>
                      <SectorsPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="messaging"
                  element={
                    <RequireRoles roles={["admin", "sector_lead", "call_centre_agent"]}>
                      <MessagingPage />
                    </RequireRoles>
                  }
                />
                <Route path="*" element={<RoleHomeRedirect />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
