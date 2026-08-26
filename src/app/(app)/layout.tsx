import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { getUser } from "@/lib/supabase/server";
import { MobileBar, MobileTopBar, SideRail } from "./nav";

/**
 * Shell for every signed-in route.
 *
 * The proxy already redirects anonymous requests, but this checks again. That
 * duplication is deliberate: the proxy is an optimistic cookie check, and a
 * layout is close enough to the data to be a real gate.
 *
 * The indigo rail is the bench's frame: one dark brand surface that survives
 * both themes, with the content laid on the canvas to its right. On a phone
 * the rail becomes a bottom bar, where a thumb already lives.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-dvh">
      <SideRail />

      <div className="flex min-w-0 flex-1 flex-col lg:pl-56">
        <MobileTopBar />

        <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-28 pt-7 lg:px-10 lg:pb-16 lg:pt-10">
          {children}
        </main>
      </div>

      <MobileBar />
    </div>
  );
}
