import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Middleware is called Proxy from Next.js 16 on, and sits next to `app`.
// An address without a language gets one: Arabic when the browser asks for
// Arabic first, English otherwise.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (/^\/(ar|en)(\/|$)/.test(pathname)) return;
  const wanted = request.headers.get('accept-language') ?? '';
  const locale = /^\s*ar\b/i.test(wanted) ? 'ar' : 'en';
  const url = request.nextUrl.clone();
  url.pathname = pathname === '/' ? `/${locale}` : `/${locale}${pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next|api|vendor|models|images|icon.svg|favicon.ico|sitemap.xml|robots.txt).*)'],
};
