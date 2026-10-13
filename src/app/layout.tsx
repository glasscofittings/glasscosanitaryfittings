import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import ThemeProvider from "@/components/providers/ThemeProvider";
import QueryProvider from "@/components/providers/QueryProvider";
import AuthProvider from "@/components/providers/AuthProvider";
import { SidebarProvider } from "@/components/providers/SidebarContext";
import { ModuleVisibilityProvider } from "@/components/providers/ModuleVisibilityContext";
import NetworkGuard from "@/components/shared/NetworkGuard";
import WebPinGuard from "@/components/shared/WebPinGuard";
import OperatorModal from "@/components/ui/OperatorModal";
import EnterToNextField from "@/components/providers/EnterToNextField";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Glassco Sanitary",
  description: "Sanitary Products Distribution & Retail Management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full bg-obsidian-bg text-foreground">
        <QueryProvider>
          <ThemeProvider>
            <AuthProvider>
              <SidebarProvider>
                <ModuleVisibilityProvider>
                  <NetworkGuard>
                    <WebPinGuard>
                      <EnterToNextField />
                      <OperatorModal />
                      <Toaster position="top-right" richColors closeButton />
                      {children}
                    </WebPinGuard>
                  </NetworkGuard>
                </ModuleVisibilityProvider>
              </SidebarProvider>
            </AuthProvider>
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
