import { ReactNode, useState, useEffect } from "react";
import { AppSidebar } from "./AppSidebar";
import { BottomNav } from "./BottomNav";
import { Menu, X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

export function AppLayout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();

  return (
    <div className="min-h-screen bg-background">
      {isMobile ? (
        <>
          {/* Mobile: bottom nav, no sidebar */}
          <main className="pb-16">
            <div className="mx-auto max-w-6xl px-3 py-3 sm:px-4">
              {children}
            </div>
          </main>
          <BottomNav />
        </>
      ) : (
        <>
          {/* Desktop: sidebar */}
          <div className="fixed left-0 top-0 z-50 h-screen">
            <AppSidebar />
          </div>
          <main className="md:pl-56">
            <div className="mx-auto max-w-6xl px-3 py-4 sm:px-4 sm:py-6 md:px-6">
              {children}
            </div>
          </main>
        </>
      )}
    </div>
  );
}
