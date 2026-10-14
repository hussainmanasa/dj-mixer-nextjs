import { writeDesiFixtures, writeFixtures } from "./fixtures";

export default function globalSetup() {
  writeFixtures();
  writeDesiFixtures();
}
