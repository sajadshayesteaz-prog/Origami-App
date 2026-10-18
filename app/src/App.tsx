import { useEffect, useState } from "react";
import { LangContext, useT, type Lang } from "./i18n";
import { Viewer } from "./components/Viewer";

const LANG_KEY = "origami.lang";

function initialLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === "en" ? "en" : "fa";
  } catch {
    return "fa";
  }
}

export function App() {
  const [lang, setLang] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* storage unavailable */
    }
  }, [lang]);

  return (
    <LangContext.Provider value={lang}>
      <Header onToggleLang={() => setLang(lang === "fa" ? "en" : "fa")} />
      <main>
        <Viewer lang={lang} />
      </main>
    </LangContext.Provider>
  );
}

function Header({ onToggleLang }: { onToggleLang: () => void }) {
  const t = useT();
  return (
    <header className="app-header">
      <h1>{t("appTitle")}</h1>
      <button className="lang-toggle" onClick={onToggleLang}>
        {t("otherLang")}
      </button>
    </header>
  );
}
