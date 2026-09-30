import type { Language } from '@/toolkit/copy';

export const siteUrl = 'https://cutstudio.omardeek.tech';
export const locales = ['ar', 'en'] as const satisfies readonly Language[];
export const isLocale = (value: string): value is Language => (locales as readonly string[]).includes(value);

export const siteCopy = {
  en: {
    name: 'Cut Studio',
    title: 'Cut Studio · free design, laser and print tools',
    description: 'Free tools that run in your browser: image to vector, Arabic lettering, nesting, box and gear makers, an AI upscaler and more. Files stay on your device.',
  },
  ar: {
    name: 'Cut Studio',
    title: 'Cut Studio · أدوات مجانية للتصميم والليزر والطباعة',
    description: 'أدوات مجانية تعمل في متصفحك: تحويل الصور إلى فيكتور، والكتابة العربية للقص، وترتيب القطع، وصانع الصناديق والتروس، وتكبير الصور بالذكاء الاصطناعي. ملفاتك تبقى على جهازك.',
  },
} satisfies Record<Language, { name: string; title: string; description: string }>;
