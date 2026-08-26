import type { Metadata, Viewport } from "next";
import { Archivo, Big_Shoulders, Courier_Prime } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
});

const bigShoulders = Big_Shoulders({
  variable: "--font-big-shoulders",
  subsets: ["latin"],
});

const courier = Courier_Prime({
  variable: "--font-courier",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "fitr",
    template: "%s · fitr",
  },
  description: "Your wardrobe, and what belongs in it next.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9e2cf" },
    { media: "(prefers-color-scheme: dark)", color: "#151b29" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${bigShoulders.variable} ${courier.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/*
          THESIS: the wardrobe as a garment worker's bench — pieces are tagged,
          outfits are laid out on indigo canvas, and a gap in an outfit is a
          repair waiting to happen. It refuses the neutral white-grid wardrobe app.
          OWN-WORLD: indigo canvas grounds, kraft hang-tag cards, copper rivets
          and stitch rules, shipping-tag type (Big Shoulders / Archivo / Courier Prime).
          STORY: a visitor understands their clothes as tagged pieces; tagging,
          composing and shopping become one continuous bench work flow.
          FIRST VIEWPORT: Today hangs one large kraft work-ticket — outfit collage
          stamped on it, the reason typed beneath like a chalk note, two riveted
          buttons at the foot — under an indigo rail of navigation.
          FORM: grounded candidate 5 of 7 (denim workwear repair bench); seed key 2d0fa3fa.
          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md.
        */}
        {children}
      </body>
    </html>
  );
}
