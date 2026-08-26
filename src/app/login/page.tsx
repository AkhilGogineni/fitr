import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

/**
 * Sign-in hangs like the app's first tag.
 *
 * One kraft ticket on the canvas, punched and strung, carrying the name in
 * the display voice. Nothing else competes — this screen has one job twice
 * (sign in, or decide to).
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-16">
      <div className="w-full max-w-[21rem] sm:max-w-sm">
        <div className="relative rounded-card border border-line bg-surface p-7 pt-9 shadow-lift">
          {/* Punched and strung: the eyelet sits on the card's shoulder, the
              cord runs off toward the rail it hangs from. */}
          <svg
            aria-hidden
            viewBox="0 0 120 64"
            className="absolute -top-14 left-8 h-14 w-[7.5rem] text-line-strong"
            fill="none"
          >
            <path
              d="M112 0C88 30 52 50 23 61"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <span aria-hidden className="eyelet absolute left-11 top-2.5" />

          <header>
            <h1 className="display text-4xl">fitr</h1>
            <p className="mt-2 font-mono text-xs leading-relaxed text-ink-muted">
              YOUR WARDROBE,
              <br />
              AND WHAT BELONGS IN IT NEXT.
            </p>
          </header>

          <div className="stitch mt-5" />

          <div className="mt-5">
            <LoginForm next={typeof next === "string" ? next : "/wardrobe"} />
          </div>
        </div>
      </div>
    </main>
  );
}
