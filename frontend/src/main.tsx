import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Sentry, sentryEnabled } from "./monitoring";
import "./styles.css";

const appNode = (
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  sentryEnabled ? (
    <Sentry.ErrorBoundary fallback={<div className="app">Unexpected UI error.</div>}>{appNode}</Sentry.ErrorBoundary>
  ) : (
    appNode
  )
);
