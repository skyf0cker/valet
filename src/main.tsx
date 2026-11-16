import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/theme.css";

import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
