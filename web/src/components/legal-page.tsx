import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

/** Who to write to about privacy, the terms, or a data request. One place, so it is changed once. */
export const LEGAL_CONTACT_EMAIL = 'parthimech1993@gmail.com';
export const LEGAL_EFFECTIVE_DATE = '22 October 2026';

/** The frame for the privacy policy and the terms: the site's header and footer, readable prose between. */
export function LegalPage({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background">
      <section className="brand-panel px-6 pb-14 pt-8 text-white sm:px-10">
        <div className="mx-auto max-w-3xl">
          <SiteHeader />
          <div className="py-10">
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/80">{intro}</p>
            <p className="mt-4 text-xs text-white/60">Effective {LEGAL_EFFECTIVE_DATE}</p>
          </div>
        </div>
      </section>

      <article
        className="mx-auto max-w-3xl px-6 py-12 text-[15px] leading-relaxed text-foreground/85 sm:px-10
          [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-foreground
          [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-foreground
          [&_p]:mb-4 [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5
          [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline"
      >
        {children}
      </article>

      <SiteFooter />
    </main>
  );
}
