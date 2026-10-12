import { redirect } from "next/navigation";

// The booth is the app; the root just sends staff there.
export default function Home() {
  redirect("/booth");
}
