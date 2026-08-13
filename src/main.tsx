// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";

import "./styles/variables.css";
import "./styles/utilities/cards.css";

import App from "./App";
import { AuthProvider } from "./features/authentication/context/AuthContext";
import { ThemeProvider } from "./shared/theme/ThemeContext";

Amplify.configure(outputs);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
