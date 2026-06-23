import './globals.css'
import { Inter } from 'next/font/google'
import NextAuthProvider from "./components/NextAuthProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Meeting Summarizer AI",
  description: "Google Meet clone with AI summarization",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <NextAuthProvider>{children}</NextAuthProvider>
      </body>
    </html>
  )
}
