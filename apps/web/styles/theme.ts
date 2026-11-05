import type { ThemeConfig } from 'antd';

/**
 * Design tokens. The brand colours below are PROVISIONAL until checked against
 * the university Brand Guideline (docs/OPEN_QUESTIONS.md §UI-1). Change them
 * here only — components read colours from the AntD token system.
 */
export const brand = {
  primary: '#1f3a8a', // deep royal blue
  accent: '#c9a227', // gold
  sidebar: '#0f1f4d',
  surface: '#f5f7fb',
};

export const theme: ThemeConfig = {
  cssVar: { prefix: 'sru' },
  token: {
    colorPrimary: brand.primary,
    colorInfo: brand.primary,
    colorWarning: '#d97706',
    colorLink: brand.primary,
    borderRadius: 8,
    fontFamily: 'var(--font-sarabun), "Sarabun", system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: 15,
    colorBgLayout: brand.surface,
  },
  components: {
    Layout: { siderBg: brand.sidebar, headerBg: '#ffffff', headerPadding: '0 24px', headerHeight: 64 },
    Menu: {
      darkItemBg: brand.sidebar,
      darkSubMenuItemBg: '#0b1840',
      darkItemSelectedBg: brand.primary,
    },
    Table: { headerBg: '#eef2fb' },
    Card: { headerFontSize: 16 },
  },
};
