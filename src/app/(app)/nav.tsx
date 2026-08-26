"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { signOut } from "@/app/login/actions";
import {
  CalendarIcon,
  EyeIcon,
  HangerIcon,
  InboxIcon,
  LayersIcon,
} from "@/components/icons";

/**
 * Navigation with a memory of where you are.
 *
 * One list drives both shells: the desktop rail and the phone's bottom bar.
 * Active state comes from the pathname, so the current section is marked
 * without any server round trip — and `/wardrobe/add` marks Wardrobe the way
 * `/inbox/want/…` marks Inbox, by prefix rather than exact match.
 */

const NAV = [
  { href: "/today", label: "Today", icon: CalendarIcon },
  { href: "/wardrobe", label: "Wardrobe", icon: HangerIcon },
  { href: "/outfits", label: "Outfits", icon: LayersIcon },
  { href: "/inbox", label: "Inbox", icon: InboxIcon },
  { href: "/watch", label: "Watch", icon: EyeIcon },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/*
 * The rail is the one surface painted the brand's deep indigo in both themes,
 * so its colours are fixed here rather than drawn from the theme tokens.
 */

export function SideRail() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col bg-[#25324c] lg:flex dark:bg-[#10141f]">
      <div className="px-6 pt-7">
        <Link
          href="/today"
          className="display text-[1.75rem] text-[#f2ecda] transition-colors hover:text-[#dd8b57]"
        >
          fitr
        </Link>
        <p className="mt-1 font-mono text-[0.625rem] tracking-wide text-[#8f97ad]">
          what belongs in it next
        </p>
      </div>

      <nav aria-label="Sections" className="mt-9 flex-1 px-3">
        <ul className="space-y-0.5">
          {NAV.map((entry) => {
            const active = isActive(pathname, entry.href);
            const Icon = entry.icon;
            return (
              <li key={entry.href}>
                <Link
                  href={entry.href}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex items-center gap-3 rounded-control px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-white/[0.06] text-[#f2ecda]"
                      : "text-[#a9b1c4] hover:bg-white/[0.04] hover:text-[#e3ddca]"
                  }`}
                >
                  {/* The stitch tick: three copper stitches marking the live section. */}
                  <span
                    aria-hidden
                    className={`absolute left-0 h-4 w-[3px] rounded-full bg-[#dd8b57] transition-opacity ${
                      active ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <Icon className="size-4 shrink-0 opacity-80" />
                  {entry.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-white/10 px-3 py-3">
        <SideFootLinks pathname={pathname} />
      </div>
    </aside>
  );
}

function SideFootLinks({ pathname }: { pathname: string }) {
  const settingsActive = isActive(pathname, "/settings");
  return (
    <>
      <Link
        href="/settings"
        aria-current={settingsActive ? "page" : undefined}
        className={`flex items-center gap-3 rounded-control px-3 py-2 text-sm transition-colors ${
          settingsActive
            ? "text-[#f2ecda]"
            : "text-[#a9b1c4] hover:text-[#e3ddca]"
        }`}
      >
        Settings
      </Link>
      <form action={signOut}>
        <button
          type="submit"
          className="w-full rounded-control px-3 py-2 text-left text-sm text-[#a9b1c4] transition-colors hover:text-[#e3ddca]"
        >
          Sign out
        </button>
      </form>
    </>
  );
}

export function MobileBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#25324c]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:bg-[#10141f]/95"
    >
      <ul className="grid grid-cols-5">
        {NAV.map((entry) => {
          const active = isActive(pathname, entry.href);
          const Icon = entry.icon;
          return (
            <li key={entry.href}>
              <Link
                href={entry.href}
                aria-current={active ? "page" : undefined}
                className="flex flex-col items-center gap-1 py-2.5"
              >
                <Icon
                  className={`size-5 transition-colors ${
                    active ? "text-[#dd8b57]" : "text-[#8f97ad]"
                  }`}
                />
                <span
                  className={`font-mono text-[0.5625rem] uppercase tracking-widest transition-colors ${
                    active ? "text-[#f2ecda]" : "text-[#8f97ad]"
                  }`}
                >
                  {entry.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function MobileTopBar() {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-[#25324c]/95 px-4 py-3 backdrop-blur lg:hidden dark:bg-[#10141f]/95">
      <Link href="/today" className="display text-xl text-[#f2ecda]">
        fitr
      </Link>
      <Link
        href="/settings"
        aria-label="Settings"
        className="text-[#a9b1c4] transition-colors hover:text-[#f2ecda]"
      >
        Settings
      </Link>
    </header>
  );
}
