import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { ConfigProvider } from "./config/ConfigContext.jsx";
import { BackendStatusProvider } from "./components/BackendStatusProvider.jsx";

createRoot(document.getElementById("root")).render(
  <ConfigProvider>
    <BackendStatusProvider>
      <App />
    </BackendStatusProvider>
  </ConfigProvider>
);
