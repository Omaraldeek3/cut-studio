import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { descriptions, seoTitles, slugs, toolFromSlug, toolIds } from '@/toolkit/copy';
import { isLocale, locales } from '../../site';

/* Each tool has a page of its own, so it can be found, linked and shared.
   The workbench itself is drawn by the locale layout; this page gives the
   address, the title and description search engines show, and the language
   alternates. */

export function generateStaticParams() {
  return locales.flatMap(locale => toolIds.map(id => ({ locale, tool: slugs[id] })));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; tool: string }> }): Promise<Metadata> {
  const { locale, tool } = await params;
  const id = toolFromSlug(tool);
  if (!isLocale(locale) || !id) return {};
  const index = locale === 'ar' ? 1 : 0;
  const title = seoTitles[id][index], description = descriptions[id][index];
  return {
    title,
    description,
    alternates: { canonical: `/${locale}/${tool}`, languages: { ar: `/ar/${tool}`, en: `/en/${tool}`, 'x-default': `/en/${tool}` } },
    openGraph: { title, description, url: `/${locale}/${tool}` },
    twitter: { card: 'summary', title, description },
  };
}

export default async function ToolPage({ params }: { params: Promise<{ locale: string; tool: string }> }) {
  const { locale, tool } = await params;
  if (!isLocale(locale) || !toolFromSlug(tool)) notFound();
  return null;
}
