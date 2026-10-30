import { redirect } from "next/navigation";

// Root redirects to the morgue (incident list).
export default function Home() {
  redirect("/morgue");
}
