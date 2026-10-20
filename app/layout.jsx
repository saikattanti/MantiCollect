import './globals.css';
import { ThemeProvider } from '@/lib/theme.jsx';
import { CSP } from '@/lib/csp.js';

export const metadata = {
  title: 'MediaVault',
  description: 'Local-first universal media downloader',
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
