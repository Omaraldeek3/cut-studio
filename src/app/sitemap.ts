import type { MetadataRoute } from 'next';
import { slugs, toolIds } from '@/toolkit/copy';
import { locales, siteUrl } from './site';

export default function sitemap(): MetadataRoute.Sitemap {
  return locales.flatMap(locale => toolIds.map(id => ({
    url: `${siteUrl}/${locale}/${slugs[id]}`,
    changeFrequency: 'monthly' as const,
    priority: id === 'trace' || id === 'nest' || id === 'box' || id === 'lettering' ? 0.9 : 0.7,
    alternates: { languages: { ar: `${siteUrl}/ar/${slugs[id]}`, en: `${siteUrl}/en/${slugs[id]}` } },
  })));
}
