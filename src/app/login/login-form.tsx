"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { type AuthState, signIn, signUp } from "./actions";
import { btnPrimary, btnTag, inputClass } from "@/lib/ui";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${btnPrimary} w-full py-2.5`}
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
            className={`${inputClass} mt-1.5 bg-paper`}
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
            className={`${inputClass} mt-1.5 bg-paper`}
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
        className={`${btnTag} mt-5 w-full text-center`}
      >
        {mode === "signin"
          ? "Need an account? Create one"
          : "Already have an account? Sign in"}
      </button>
    </div>
  );
}
