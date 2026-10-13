import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { MoodEditor } from "@/components/moods/MoodEditor";

export const metadata: Metadata = { title: "Moods · AI DJ Mixer" };

export default function MoodsPage() {
  return (
    <>
      <Nav active="/moods" />
      <MoodEditor />
    </>
  );
}
