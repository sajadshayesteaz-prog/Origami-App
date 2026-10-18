import { createContext, useContext } from "react";

export type Lang = "fa" | "en";

const strings = {
  appTitle: { fa: "اوریگامی", en: "Origami" },
  otherLang: { fa: "English", en: "فارسی" },
  sample: { fa: "نمونه", en: "Sample" },
  chooseSample: { fa: "انتخاب نمونه…", en: "Choose a sample…" },
  openFile: { fa: "باز کردن فایل", en: "Open file" },
  prev: { fa: "قبلی", en: "Previous" },
  next: { fa: "بعدی", en: "Next" },
  frame: { fa: "مرحله", en: "Step" },
  of: { fa: "از", en: "of" },
  view2d: { fa: "الگوی چین (دوبعدی)", en: "Crease pattern (2D)" },
  view3d: { fa: "حالت تاخورده (سه‌بعدی)", en: "Folded state (3D)" },
  foldPercent: { fa: "میزان تا", en: "Fold amount" },
  resetView: { fa: "بازنشانی دید", en: "Reset view" },
  simLoading: { fa: "در حال بارگذاری شبیه‌ساز…", en: "Loading simulator…" },
  noFile: { fa: "یک نمونه انتخاب کنید یا فایلی باز کنید.", en: "Choose a sample or open a file." },
  loadError: { fa: "خطا در خواندن فایل", en: "Could not read file" },
  mountain: { fa: "کوه", en: "Mountain" },
  valley: { fa: "دره", en: "Valley" },
  flat: { fa: "تای باز", en: "Flat" },
  boundary: { fa: "لبه", en: "Boundary" },
  keyboardHint: { fa: "کلیدهای جهت‌نما: مرحله قبل / بعد", en: "Arrow keys: previous / next step" },
} satisfies Record<string, Record<Lang, string>>;

export type StringKey = keyof typeof strings;

export const LangContext = createContext<Lang>("fa");

export function useT() {
  const lang = useContext(LangContext);
  return (key: StringKey) => strings[key][lang];
}

export function formatNumber(n: number, lang: Lang) {
  return new Intl.NumberFormat(lang === "fa" ? "fa-IR" : "en-US").format(n);
}
