import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// Shim for the sandbox storage API the reference app expects
if (!window.storage) {
  window.storage = {
    async get(key) {
      const v = localStorage.getItem(key);
      return v == null ? undefined : { value: v };
    },
    async set(key, value) {
      localStorage.setItem(key, value);
      return true;
    }
  };
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
