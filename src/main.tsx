import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/theme.css";

import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

function applyAutoCorrectDisable(el: Element) {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.setAttribute("autocorrect", "off");
    el.setAttribute("autocapitalize", "off");
    el.setAttribute("spellcheck", "false");
    el.spellcheck = false;
  }
}

function installWebKitInputSanitizer() {
  if (typeof document === "undefined") return;
  const applyTree = (root: ParentNode) => {
    root.querySelectorAll("input, textarea").forEach(applyAutoCorrectDisable);
  };
  applyTree(document);

  document.addEventListener(
    "focusin",
    (e) => {
      if (e.target instanceof Element) {
        applyAutoCorrectDisable(e.target);
      }
    },
    true,
  );

  if (typeof MutationObserver !== "undefined" && document.body) {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            applyAutoCorrectDisable(node);
            applyTree(node);
          }
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

installWebKitInputSanitizer();

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
