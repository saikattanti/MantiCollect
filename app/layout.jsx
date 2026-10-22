import './globals.css';
import { ThemeProvider } from '@/lib/theme.jsx';
import { CSP } from '@/lib/csp.js';

export const metadata = {
  title: 'MantiCollect — A Mantitup Product',
  description: 'Local-first universal media downloader and digital collector for Windows',
  icons: {
    icon: '/MantiCollect-fav-tr.png'
  },
  other: {
    'Content-Security-Policy': CSP
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark" data-theme="dark" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
