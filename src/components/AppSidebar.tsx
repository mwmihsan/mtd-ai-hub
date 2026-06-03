import { NavLink as RouterNavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Sun, Moon, LayoutDashboard, Shield, MessageCircle, GraduationCap } from "lucide-react";
import { useState, useEffect } from "react";

export function AppSidebar() {
  const location = useLocation();
  const [dark, setDark] = useState(() => {
    if (typeof window !== "undefined") {
      return document.documentElement.classList.contains("dark");
    }
    return false;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const links = [
    { to: "/admin", label: "Admin Panel", icon: Shield },
    { to: "/telegram", label: "Telegram Bot", icon: MessageCircle },
    { to: "/training", label: "Training Center", icon: GraduationCap },
  ];

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
          <LayoutDashboard className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="text-sm font-semibold text-foreground">Accounts Hub</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-3">
        {links.map((link) => (
          <RouterNavLink
            key={link.to}
            to={link.to}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              location.pathname === link.to
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <link.icon className="h-4 w-4" />
            {link.label}
          </RouterNavLink>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <button
          onClick={() => setDark(!dark)}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {dark ? "Light mode" : "Dark mode"}
        </button>
      </div>
    </aside>
  );
}
