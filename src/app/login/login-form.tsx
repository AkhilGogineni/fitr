"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { type AuthState, signIn, signUp } from "./actions";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-card bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {pending ? "…" : label}
    </button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const action = mode === "signin" ? signIn : signUp;
  const [state, formAction] = useActionState<AuthState, FormData>(action, null);

  return (
    <div>
      {/*
        `key` remounts the form when the mode flips, which resets the action
        state. Without it, an error from a failed sign-in would linger on the
        sign-up form.
      */}
      <form key={mode} action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />

        <div>
          <label htmlFor="email" className="label block">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="mt-1.5 w-full rounded-card border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-line-strong"
          />
        </div>

        <div>
          <label htmlFor="password" className="label block">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={
              mode === "signin" ? "current-password" : "new-password"
            }
            required
            minLength={8}
            className="mt-1.5 w-full rounded-card border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-line-strong"
          />
        </div>

        {state?.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}

        <SubmitButton label={mode === "signin" ? "Sign in" : "Create account"} />
      </form>

      <button
        type="button"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="mt-5 w-full text-center text-xs text-ink-muted underline underline-offset-4 hover:text-ink"
      >
        {mode === "signin"
          ? "Need an account? Create one"
          : "Already have an account? Sign in"}
      </button>
    </div>
  );
}
