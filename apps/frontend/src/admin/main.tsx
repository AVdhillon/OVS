
    import { createRoot } from "react-dom/client";
    import AdminApp from "./App";
    import "../styles/index.css";
    console.log(import.meta.env);
    createRoot(document.getElementById("root")!).render(<AdminApp />);
