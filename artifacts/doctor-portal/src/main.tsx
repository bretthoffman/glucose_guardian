import { createRoot } from "react-dom/client";
import App from "./App";
import "@/lib/env";
import "@/lib/theme"; // applies the theme class + follows system changes
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
