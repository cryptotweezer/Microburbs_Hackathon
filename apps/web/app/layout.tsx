// Minimal root layout: this Next.js app only serves API route handlers.
export const metadata = { title: "Microburbs Listing Lens API" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
