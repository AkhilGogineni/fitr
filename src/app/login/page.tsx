import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · fitr" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <header className="mb-10">
          <h1 className="display text-3xl font-medium">fitr</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Your wardrobe, and what belongs in it next.
          </p>
        </header>
        <LoginForm next={typeof next === "string" ? next : "/wardrobe"} />
      </div>
    </main>
  );
}
