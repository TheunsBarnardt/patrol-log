import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
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
import { authStore } from "./lib/api";

function RequireAuth({ children }: { children: JSX.Element }) {
  const token = authStore.getToken();
  if (!token) return <Navigate to="/login" replace />;
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
                <Route index element={<DashboardPage />} />
                <Route path="residents" element={<ResidentsPage />} />
                <Route path="members" element={<MembersPage />} />
                <Route path="emergency-services" element={<EmergencyServicesPage />} />
                <Route path="vehicles" element={<VehiclesPage />} />
                <Route path="patrols" element={<PatrolsPage />} />
                <Route path="devices" element={<DevicesPage />} />
                <Route path="audit-log" element={<AuditLogPage />} />
                <Route path="live-map" element={<LiveMapPage />} />
                <Route path="sectors" element={<SectorsPage />} />
                <Route path="messaging" element={<MessagingPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
