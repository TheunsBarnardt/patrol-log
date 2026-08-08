import { Link, NavLink, Navigate, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { authStore } from "../lib/api";
import { APP_VERSION } from "../version";

type Role = "system_admin" | "admin" | "sector_lead" | "call_centre_agent" | "patroller";

type NavItem = {
  to: string;
  label: string;
  end?: boolean;
  /** null = all portal users; otherwise only listed roles */
  roles: Role[] | null;
};

/** Sector ops: directory CRUD, patrols, messaging, live map */
const OPS: Role[] = ["system_admin", "admin", "sector_lead", "call_centre_agent"];
/** Platform tools — system admin only */
const SYS: Role[] = ["system_admin"];

const NAV_ALL: NavItem[] = [
  { to: "/", label: "Dashboard", end: true, roles: OPS },
  { to: "/live-map", label: "Live Map", roles: OPS },
  { to: "/messaging", label: "Messaging", roles: OPS },
  { to: "/residents", label: "Residents", roles: OPS },
  { to: "/members", label: "Members", roles: OPS },
  { to: "/emergency-services", label: "Emergency services", roles: OPS },
  { to: "/vehicles", label: "Vehicles", roles: OPS },
  { to: "/patrols", label: "Patrols", roles: OPS },
  { to: "/reports", label: "Reports", roles: OPS },
  { to: "/hotspots", label: "Hotspots", roles: OPS },
  { to: "/sectors", label: "Sectors", roles: SYS },
  { to: "/devices", label: "Devices", roles: SYS },
  { to: "/audit-log", label: "Audit log", roles: SYS },
  { to: "/system-backup", label: "System backup", roles: SYS },
  { to: "/my-details", label: "My details", roles: ["patroller"] },
];

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const profile = authStore.getProfile();
  const accessLevel = (profile?.access_level ?? "") as Role;

  const navItems = NAV_ALL.filter(
    (item) => item.roles === null || item.roles.includes(accessLevel),
  );

  function logout() {
    authStore.clearToken();
    authStore.clearProfile();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex h-full bg-gray-50">
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200 flex items-center gap-3">
          <img
            src="/LOGO.jpg"
            alt="CPF Logo"
            className="h-10 w-10 rounded-full object-cover flex-shrink-0 shadow-sm"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <div>
            <Link to="/" className="text-base font-extrabold tracking-tight leading-tight block">PATROL LOG</Link>
            <p className="text-xs text-gray-500">
              {accessLevel === "system_admin"
                ? "System admin · all sectors"
                : profile?.sector
                  ? profile.sector
                  : accessLevel === "patroller"
                    ? "Member portal"
                    : "Admin Portal"}
            </p>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-md text-sm font-medium ${
                  isActive ? "bg-brand-primary text-white" : "text-gray-700 hover:bg-gray-100"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-200 text-xs">
          {profile && (
            <>
              <p className="font-semibold">{profile.name}</p>
              <p className="text-gray-500">
                {profile.call_sign}
                {profile.sector ? ` · ${profile.sector}` : ""} · {profile.access_level}
              </p>
            </>
          )}
          <p className="mt-2 text-gray-400">About · v{APP_VERSION}</p>
          <button onClick={logout} className="mt-2 w-full text-left text-red-600 hover:underline">Log out</button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}

/** Redirect users away from pages their role cannot open. */
export function RoleHomeRedirect() {
  const level = authStore.getProfile()?.access_level;
  if (level === "patroller") return <Navigate to="/my-details" replace />;
  return <Navigate to="/" replace />;
}
