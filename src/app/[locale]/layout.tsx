import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import localFont from 'next/font/local';
import Toolkit from '@/toolkit/toolkit';
import { isLocale, locales, siteCopy, siteUrl } from '../site';
import '../tools.css';
import '../workshop.css';

// Both faces come from node_modules, so a visit makes no third-party request.
const latin = localFont({ src: '../../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2', variable: '--tool-latin', weight: '200 800', display: 'swap' });
const arabic = localFont({
  src: [
    { path: '../../../node_modules/@fontsource/tajawal/files/tajawal-arabic-400-normal.woff2', weight: '400' },
    { path: '../../../node_modules/@fontsource/tajawal/files/tajawal-arabic-500-normal.woff2', weight: '500' },
    { path: '../../../node_modules/@fontsource/tajawal/files/tajawal-arabic-700-normal.woff2', weight: '700' },
  ],
  variable: '--tool-arabic',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f2f1ed' }, { media: '(prefers-color-scheme: dark)', color: '#0f1210' }],
};

export function generateStaticParams() { return locales.map(locale => ({ locale })); }

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = siteCopy[locale];
  return {
    metadataBase: new URL(siteUrl),
    title: { default: t.title, template: `%s · ${t.name}` },
    description: t.description,
    applicationName: t.name,
    authors: [{ name: 'Omar Aldeek', url: 'https://omardeek.tech' }],
    openGraph: { siteName: t.name, type: 'website', locale: locale === 'ar' ? 'ar_PS' : 'en_US' },
    icons: { icon: '/icon.svg' },
  };
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} className={`${latin.variable} ${arabic.variable}`}>
      <body>
        <Toolkit lang={locale} />
        {children}
      </body>
    </html>
  );
}
