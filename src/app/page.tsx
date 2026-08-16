import { redirect } from "next/navigation";

export default function Home() {
  // The proxy sends anonymous visitors to /login, so this only runs when signed in.
  redirect("/today");
}
