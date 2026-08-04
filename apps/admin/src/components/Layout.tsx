import { Link, NavLink, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { authStore } from "../lib/api";

type Role = "system_admin" | "admin" | "sector_lead" | "call_centre_agent" | "patroller";

type NavItem = {
  to: string;
  label: string;
  end?: boolean;
  /** null = all portal users; otherwise only listed roles */
  roles: Role[] | null;
  group?: "ops" | "admin";
};

/** Sector ops: directory CRUD, patrols, messaging, live map */
const OPS: Role[] = ["system_admin", "admin", "sector_lead", "call_centre_agent"];
/** Platform tools — system admin only */
const SYS: Role[] = ["system_admin"];

const NAV_ALL: NavItem[] = [
  { to: "/", label: "Dashboard", end: true, roles: OPS, group: "ops" },
  { to: "/live-map", label: "Live Map", roles: OPS, group: "ops" },
  { to: "/messaging", label: "Messaging", roles: OPS, group: "ops" },
  { to: "/patrols", label: "Patrols", roles: OPS, group: "ops" },
  { to: "/reports", label: "Reports", roles: OPS, group: "ops" },
  { to: "/hotspots", label: "Hotspots", roles: OPS, group: "ops" },
  { to: "/residents", label: "Residents", roles: OPS, group: "ops" },
  { to: "/members", label: "Members", roles: OPS, group: "ops" },
  { to: "/emergency-services", label: "Emergency services", roles: OPS, group: "ops" },
  { to: "/vehicles", label: "Vehicles", roles: OPS, group: "ops" },
  { to: "/sectors", label: "Sectors", roles: SYS, group: "admin" },
  { to: "/devices", label: "Devices", roles: SYS, group: "admin" },
  { to: "/audit-log", label: "Audit log", roles: SYS, group: "admin" },
  { to: "/system-backup", label: "System backup", roles: SYS, group: "admin" },
  { to: "/my-details", label: "My details", roles: ["patroller"], group: "ops" },
];

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const profile = authStore.getProfile();
  const accessLevel = (profile?.access_level ?? "") as Role;

  const navItems = NAV_ALL.filter(
    (item) => item.roles === null || item.roles.includes(accessLevel),
  );
  const opsItems = navItems.filter((i) => i.group !== "admin");
  const adminItems = navItems.filter((i) => i.group === "admin");

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  function logout() {
    authStore.clearToken();
    authStore.clearProfile();
    navigate("/login", { replace: true });
  }

  const subtitle =
    accessLevel === "system_admin"
      ? "System admin · all sectors"
      : profile?.sector
        ? profile.sector
        : accessLevel === "patroller"
          ? "Member portal"
          : "Admin Portal";

  return (
    <div className="app-shell flex h-full flex-col md:flex-row">
      {/* Mobile top bar */}
      <header className="safe-pt sticky top-0 z-30 border-b border-brand-line/80 bg-white/90 backdrop-blur-md md:hidden">
        <div className="brand-stripe h-1 w-full" />
        <div className="flex items-center gap-3 px-3 py-2.5">
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primarySoft text-brand-primary"
          >
            <MenuIcon open={menuOpen} />
          </button>
          <img
            src="/LOGO.jpg"
            alt="CPF Logo"
            className="h-9 w-9 rounded-full object-cover ring-2 ring-brand-yellow/70 shadow-sm"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold tracking-tight text-brand-ink">PATROL LOG</p>
            <p className="truncate text-[11px] text-brand-muted">{subtitle}</p>
          </div>
        </div>
      </header>

      {/* Mobile drawer backdrop */}
      {menuOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-brand-ink/40 backdrop-blur-[2px] md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Sidebar / drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(20rem,88vw)] flex-col border-r border-brand-line bg-white shadow-soft transition-transform duration-200 ease-out md:static md:z-0 md:w-64 md:translate-x-0 md:shadow-none ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="brand-stripe h-1 w-full" />
        <div className="flex items-center gap-3 border-b border-brand-line px-4 py-4">
          <img
            src="/LOGO.jpg"
            alt="CPF Logo"
            className="h-11 w-11 rounded-full object-cover ring-2 ring-brand-yellow/80 shadow-sm"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <div className="min-w-0">
            <Link to="/" className="block text-base font-extrabold tracking-tight text-brand-ink">
              PATROL LOG
            </Link>
            <p className="truncate text-xs text-brand-muted">{subtitle}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          <NavSection label="Operations" items={opsItems} />
          {adminItems.length > 0 && <NavSection label="System" items={adminItems} />}
        </nav>

        <div className="safe-pb border-t border-brand-line p-4">
          {profile && (
            <div className="mb-3 rounded-xl bg-brand-primarySoft/70 px-3 py-2.5">
              <p className="truncate text-sm font-semibold text-brand-ink">{profile.name}</p>
              <p className="truncate text-xs text-brand-muted">
                {profile.call_sign}
                {profile.sector ? ` · ${profile.sector}` : ""} · {profile.access_level}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={logout}
            className="w-full rounded-xl border border-brand-accent/20 bg-red-50 px-3 py-2.5 text-left text-sm font-semibold text-brand-accent transition hover:bg-red-100"
          >
            Log out
          </button>
        </div>
      </aside>

      <main className="safe-pb flex-1 overflow-auto px-3 py-4 sm:px-5 sm:py-6 md:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-7xl">{children}</div>
      </main>
    </div>
  );
}

function NavSection({ label, items }: { label: string; items: NavItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-brand-muted">
        {label}
      </p>
      <div className="space-y-0.5">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                isActive
                  ? "bg-brand-primary text-white shadow-sm"
                  : "text-brand-ink/80 hover:bg-brand-primarySoft hover:text-brand-primary"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isActive ? "bg-brand-yellow" : "bg-brand-green/70"
                  }`}
                />
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      {open ? (
        <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      ) : (
        <>
          <path d="M3.5 5.5h13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M3.5 10h13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M3.5 14.5h13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/** Redirect users away from pages their role cannot open. */
export function RoleHomeRedirect() {
  const level = authStore.getProfile()?.access_level;
  if (level === "patroller") return <Navigate to="/my-details" replace />;
  return <Navigate to="/" replace />;
}
