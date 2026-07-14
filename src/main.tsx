import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/index.css";

// Phase 3 SPIKE: a minimal dev-only route. No router in this app, so we branch
// on the pathname before mounting. Keeps the jam-spike harness fully out of the
// main UI and its bundle-time imports off the App tree.
const isJamSpike = window.location.pathname === "/jam-spike";

async function mount() {
  const root = ReactDOM.createRoot(document.getElementById("root")!);
  if (isJamSpike) {
    const { default: JamSpike } = await import("./JamSpike");
    root.render(
      <React.StrictMode>
        <JamSpike />
      </React.StrictMode>
    );
  } else {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  }
}

void mount();
