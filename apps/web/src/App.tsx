import { Link, Route, Routes, useLocation } from "react-router-dom";
import { FormPage } from "./pages/FormPage";
import { IntroPage } from "./pages/IntroPage";
import { ResultPage } from "./pages/ResultPage";

const navItems = [
  { href: "/", label: "介绍页" },
  { href: "/form", label: "表单页" },
  { href: "/result", label: "结果页" },
];

export function App() {
  const location = useLocation();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Acai V1 Scaffold</p>
          <div className="brand-row">
            <span className="brand-mark">阿财</span>
            <span className="brand-sub">A 股候选筛选与研读辅助</span>
          </div>
        </div>
        <nav className="topnav">
          {navItems.map((item) => (
            <Link
              key={item.href}
              className={location.pathname === item.href ? "topnav-link is-current" : "topnav-link"}
              to={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="page-shell">
        <Routes>
          <Route path="/" element={<IntroPage />} />
          <Route path="/form" element={<FormPage />} />
          <Route path="/result" element={<ResultPage />} />
        </Routes>
      </main>
    </div>
  );
}

