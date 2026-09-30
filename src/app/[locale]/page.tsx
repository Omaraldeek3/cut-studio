import { notFound, redirect } from 'next/navigation';
import { defaultTool, slugs } from '@/toolkit/copy';
import { isLocale } from '../site';

// A bare language address opens the first tool.
export default async function LocaleHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  redirect(`/${locale}/${slugs[defaultTool]}`);
}
