import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'مُصوِّر C++',
  description: 'شاهد تنفيذ كود C++ سطراً بسطر: المؤشرات كأسهم، الـ Stack والـ Heap، new و delete.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
        />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='%232f6fed'/><text x='32' y='41' font-size='24' text-anchor='middle' fill='white' font-family='monospace' font-weight='700'>C++</text></svg>" />
      </head>
      <body>{children}</body>
    </html>
  );
}
