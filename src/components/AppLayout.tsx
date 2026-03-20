import { ReactNode, useState } from "react";
import { AppSidebar } from "./AppSidebar";
import { Menu, X } from "lucide-react";

export function AppLayout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile header */}
      <div className="fixed left-0 right-0 top-0 z-50 flex h-12 items-center border-b border-border bg-card px-3 md:hidden">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <span className="ml-2 text-sm font-semibold text-foreground">Accounts Hub</span>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed left-0 top-0 z-50 h-screen transform transition-transform md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:block`}
        onClick={() => mobileOpen && setMobileOpen(false)}
      >
        <AppSidebar />
      </div>

      {/* Main content */}
      <main className="pt-12 md:pl-56 md:pt-0">
        <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6 md:px-6">
          {children}
        </div>
      </main>
    </div>
  );
}
