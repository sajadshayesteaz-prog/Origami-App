import { useState } from "react";
import { Player } from "./player/Player";
import { Viewer } from "./components/Viewer";

type Tab = "player" | "fold";

export function App() {
  const [tab, setTab] = useState<Tab>("player");
  return (
    <>
      <header className="app-header">
        <h1>Origami</h1>
        <nav>
          <button className={tab === "player" ? "active" : ""} onClick={() => setTab("player")}>
            Model player
          </button>
          <button className={tab === "fold" ? "active" : ""} onClick={() => setTab("fold")}>
            FOLD viewer
          </button>
        </nav>
      </header>
      <main>{tab === "player" ? <Player /> : <Viewer />}</main>
    </>
  );
}
