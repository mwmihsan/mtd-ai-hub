import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Bot, Shield, Sun, Moon, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";

const links = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/agent", label: "Agent", icon: Bot },
  { to: "/admin", label: "Admin", icon: Shield },
  { to: "/telegram", label: "Telegram", icon: MessageCircle },
];

export function BottomNav() {
  const location = useLocation();
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined" ? document.documentElement.classList.contains("dark") : false
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-border bg-card px-1 py-1.5 safe-bottom">
      {links.map((link) => {
        const active = location.pathname === link.to;
        return (
          <NavLink
            key={link.to}
            to={link.to}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium transition-colors",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <link.icon className={cn("h-5 w-5", active && "text-primary")} />
            {link.label}
          </NavLink>
        );
      })}
      <button
        onClick={() => setDark(!dark)}
        className="flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium text-muted-foreground transition-colors"
      >
        {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        {dark ? "Light" : "Dark"}
      </button>
    </nav>
  );
}
