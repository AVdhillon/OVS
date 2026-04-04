
    import { createRoot } from "react-dom/client";
    import App from "./app/App";
    import "./styles/index.css";
    console.log(import.meta.env);
    createRoot(document.getElementById("root")!).render(<App />);
