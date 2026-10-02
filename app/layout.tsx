import type { Metadata, Viewport } from 'next';
import '@fontsource/lilita-one/400.css';
import '@fontsource-variable/fredoka';
import '@fontsource-variable/unbounded';
import '@fontsource/press-start-2p/400.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bengaluru AI Traffic',
  description: 'A miniature Bangalore whose evening traffic is driven by real AI model usage routed through OpenRouter.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1b1628',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
