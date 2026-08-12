import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { signOut } from "@/app/login/actions";
import { getUser } from "@/lib/supabase/server";

const NAV = [
  { href: "/wardrobe", label: "Wardrobe" },
  { href: "/outfits", label: "Outfits" },
  { href: "/today", label: "Today" },
  { href: "/inbox", label: "Inbox" },
] as const;

/**
 * Shell for every signed-in route.
 *
 * The proxy already redirects anonymous requests, but this checks again. That
 * duplication is deliberate: the proxy is an optimistic cookie check, and a
 * layout is close enough to the data to be a real gate.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3.5">
          <Link href="/wardrobe" className="display text-base font-medium">
            fitr
          </Link>

          <nav className="flex items-center gap-5 text-sm text-ink-muted">
            {NAV.map((entry) => (
              <Link
                key={entry.href}
                href={entry.href}
                className="transition-colors hover:text-ink"
              >
                {entry.label}
              </Link>
            ))}
          </nav>

          <form action={signOut} className="ml-auto">
            <button
              type="submit"
              className="text-xs text-ink-faint transition-colors hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10">
        {children}
      </main>
    </div>
  );
}
