import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import NavBar from "./components/NavBar";
import Home from "./pages/Home";
import Connections from "./pages/Connections";
import ErrorPage from "./pages/Error";
import { ThemeProvider } from "@/components/theme-provider";
import { ModeToggle } from "./components/mode-toggle";
import { Toaster } from "@/components/ui/toaster";
import templateConfig from "../template.config.json";

function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <div className="flex flex-col h-screen relative">
        <Router>
          <Toaster />
          <NavBar />
          <main className="flex-1 relative overflow-auto">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/connections" element={<Connections />} />
              <Route path="/error" element={<ErrorPage />} />
            </Routes>
          </main>
          <ModeToggle />
        </Router>
      </div>
    </ThemeProvider>
  );
}

export default App;