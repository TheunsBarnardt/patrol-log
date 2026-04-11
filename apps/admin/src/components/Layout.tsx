import { Link, NavLink, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { authStore } from "../lib/api";

const NAV_ALL = [
  { to: "/", label: "Dashboard", end: true, roles: null },
  { to: "/live-map", label: "Live Map", roles: null },
  { to: "/residents", label: "Residents", roles: null },
  { to: "/members", label: "Members", roles: null },
  { to: "/emergency-services", label: "Emergency services", roles: null },
  { to: "/vehicles", label: "Vehicles", roles: null },
  { to: "/patrols", label: "Patrols", roles: null },
  { to: "/devices", label: "Devices", roles: null },
  { to: "/audit-log", label: "Audit log", roles: null },
  // Admin-only
  { to: "/sectors", label: "Sectors", roles: ["admin"] as string[] },
  // Admin + sector_lead + call_centre_agent
  { to: "/messaging", label: "Messaging", roles: ["admin", "sector_lead", "call_centre_agent"] as string[] },
];

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const profile = authStore.getProfile();
  const accessLevel = profile?.access_level ?? "";

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
            <p className="text-xs text-gray-500">Admin Portal</p>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end as boolean | undefined}
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
              <p className="text-gray-500">{profile.call_sign} · {profile.access_level}</p>
            </>
          )}
          <button onClick={logout} className="mt-2 w-full text-left text-red-600 hover:underline">Log out</button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
