import { Navigate, Route, Routes } from "react-router-dom";
import { Layout, RoleHomeRedirect } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ResidentsPage } from "./pages/ResidentsPage";
import { MembersPage } from "./pages/MembersPage";
import { EmergencyServicesPage } from "./pages/EmergencyServicesPage";
import { VehiclesPage } from "./pages/VehiclesPage";
import { PatrolsPage } from "./pages/PatrolsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { DevicesPage } from "./pages/DevicesPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { LiveMapPage } from "./pages/LiveMapPage";
import { MessagingPage } from "./pages/MessagingPage";
import { MyDetailsPage } from "./pages/MyDetailsPage";
import { SystemBackupPage } from "./pages/SystemBackupPage";
import { HotspotsPage } from "./pages/HotspotsPage";
import { SectorsPage } from "./pages/SectorsPage";
import { authStore } from "./lib/api";

type Role = "system_admin" | "admin" | "sector_lead" | "call_centre_agent" | "patroller";

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = authStore.getToken();
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

function RequireRoles({
  roles,
  children,
}: {
  roles: Role[];
  children: JSX.Element;
}) {
  const level = authStore.getProfile()?.access_level;
  if (!level || !roles.includes(level)) return <RoleHomeRedirect />;
  return children;
}

const OPS: Role[] = ["system_admin", "admin", "sector_lead", "call_centre_agent"];
const SYS: Role[] = ["system_admin"];

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
                    <RequireRoles roles={OPS}>
                      <DashboardPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="my-details"
                  element={
                    <RequireRoles roles={["patroller", "system_admin", "admin", "sector_lead", "call_centre_agent"]}>
                      <MyDetailsPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="residents"
                  element={
                    <RequireRoles roles={OPS}>
                      <ResidentsPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="members"
                  element={
                    <RequireRoles roles={OPS}>
                      <MembersPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="emergency-services"
                  element={
                    <RequireRoles roles={OPS}>
                      <EmergencyServicesPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="vehicles"
                  element={
                    <RequireRoles roles={OPS}>
                      <VehiclesPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="patrols"
                  element={
                    <RequireRoles roles={OPS}>
                      <PatrolsPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="reports"
                  element={
                    <RequireRoles roles={OPS}>
                      <ReportsPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="hotspots"
                  element={
                    <RequireRoles roles={OPS}>
                      <HotspotsPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="sectors"
                  element={
                    <RequireRoles roles={SYS}>
                      <SectorsPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="devices"
                  element={
                    <RequireRoles roles={SYS}>
                      <DevicesPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="audit-log"
                  element={
                    <RequireRoles roles={SYS}>
                      <AuditLogPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="live-map"
                  element={
                    <RequireRoles roles={OPS}>
                      <LiveMapPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="system-backup"
                  element={
                    <RequireRoles roles={SYS}>
                      <SystemBackupPage />
                    </RequireRoles>
                  }
                />
                <Route
                  path="messaging"
                  element={
                    <RequireRoles roles={OPS}>
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
