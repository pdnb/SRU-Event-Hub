import type { ThemeConfig } from 'antd';

/**
 * Brand palette: sky blue / slate grey / white.
 * PROVISIONAL until checked against the university Brand Guideline
 * (docs/OPEN_QUESTIONS.md §UI-1).
 */
export const brand = {
  primary: '#0466c8', // sky blue (sky-600: white text stays readable on it)
  accent: '#e2e8f0', // light grey
  sidebar: '#1e2b3d', // slate grey
  surface: '#f8fafc', // near-white page background
};

/** AntD default theme + Anuphan font + brand colours. */
export const theme: ThemeConfig = {
  cssVar: { prefix: 'sru' },
  token: {
    colorPrimary: brand.primary,
    colorInfo: brand.primary,
    colorLink: brand.primary,
    colorBgLayout: brand.surface,
    fontFamily: 'var(--font-anuphan), "Anuphan", system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  components: {
    // The admin header holds dark text/icons; AntD's default header is dark navy.
    Layout: { headerBg: '#ffffff', headerPadding: '0 24px', siderBg: brand.sidebar },
    Menu: { darkItemBg: brand.sidebar, darkSubMenuItemBg: '#1e293b', darkItemSelectedBg: brand.primary },
  },
};
