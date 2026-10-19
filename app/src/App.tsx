import { useState } from "react";
import { Player } from "./player/Player";
import { ReviewScreen } from "./review/ReviewScreen";

type Tab = "player" | "review";

export function App() {
  const [tab, setTab] = useState<Tab>("player");
  return (
    <>
      <header className="app-header">
        <h1>Origami</h1>
        <nav>
          <button className={tab === "player" ? "active" : ""} onClick={() => setTab("player")}>
            Library
          </button>
          <button className={tab === "review" ? "active" : ""} onClick={() => setTab("review")} data-testid="tab-review">
            Import review
          </button>
        </nav>
      </header>
      <main>{tab === "player" ? <Player /> : <ReviewScreen />}</main>
    </>
  );
}
