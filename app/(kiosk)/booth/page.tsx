import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import { Booth } from "@/components/booth/Booth";

export const metadata: Metadata = { title: "Booth · AI DJ Mixer" };

export default function BoothPage() {
  return (
    <>
      <Nav active="/booth" />
      <Booth />
    </>
  );
}
