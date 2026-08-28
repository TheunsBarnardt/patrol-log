import { useState } from "react";
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
  const [navOpen, setNavOpen] = useState(false);
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

  const roleLine =
    accessLevel === "system_admin"
      ? "System admin · all sectors"
      : profile?.sector
        ? profile.sector
        : accessLevel === "patroller"
          ? "Member portal"
          : "Admin Portal";

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50 md:flex-row">
      <header className="relative z-[1100] flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-3 py-2 md:hidden">
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100"
          aria-label="Open menu"
          onClick={() => setNavOpen(true)}
        >
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <img
          src="/LOGO.jpg"
          alt=""
          className="h-8 w-8 rounded-full object-cover"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
        <span className="text-sm font-extrabold tracking-tight">PATROL LOG</span>
      </header>

      {navOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-[1200] bg-black/40 md:hidden"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-[1300] flex w-72 max-w-[85vw] flex-col border-r border-gray-200 bg-white transition-transform md:static md:z-auto md:w-64 md:max-w-none md:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 border-b border-gray-200 p-4">
          <img
            src="/LOGO.jpg"
            alt="CPF Logo"
            className="h-10 w-10 flex-shrink-0 rounded-full object-cover shadow-sm"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <div className="min-w-0 flex-1">
            <Link to="/" className="block text-base font-extrabold leading-tight tracking-tight" onClick={() => setNavOpen(false)}>
              PATROL LOG
            </Link>
            <p className="truncate text-xs text-gray-500">{roleLine}</p>
          </div>
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 md:hidden"
            aria-label="Close menu"
            onClick={() => setNavOpen(false)}
          >
            ✕
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setNavOpen(false)}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2.5 text-sm font-medium ${
                  isActive ? "bg-brand-primary text-white" : "text-gray-700 hover:bg-gray-100"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-gray-200 p-4 text-xs">
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
      <main className="min-h-0 min-w-0 flex-1 overflow-auto p-4 md:p-6">{children}</main>
    </div>
  );
}

/** Redirect users away from pages their role cannot open. */
export function RoleHomeRedirect() {
  const level = authStore.getProfile()?.access_level;
  if (level === "patroller") return <Navigate to="/my-details" replace />;
  return <Navigate to="/" replace />;
}
