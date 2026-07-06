import { LegalPage, LegalSection } from "@/components/LegalPage";

const CONTACT_EMAIL = "harkirat.iitr@gmail.com";

export function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="June 30, 2026">
      <p className="text-sm leading-7 text-muted-foreground">
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of Pixovid.
        By creating an account or using the service, you agree to these Terms.
      </p>

      <LegalSection heading="Eligibility & accounts">
        <p>
          You must be at least 18 years old to use Pixovid. You are responsible for keeping your
          account credentials secure and for all activity under your account.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <ul className="list-disc space-y-1 pl-5">
          <li>Do not generate content that is illegal, harmful, or infringes others&rsquo; rights.</li>
          <li>
            Do not upload photos of people without their consent, or create deceptive or harmful
            likenesses of real individuals.
          </li>
          <li>Do not attempt to disrupt, reverse engineer, or abuse the service.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Credits & payments">
        <p>
          Paid features are accessed using prepaid credits purchased through Razorpay. All purchases
          are subject to our{" "}
          <a className="text-primary hover:underline" href="/refund">
            Refund &amp; Cancellation Policy
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="Content & ownership">
        <p>
          You retain rights to the content you upload and, subject to these Terms and applicable
          law, to the media you generate. You are responsible for ensuring you have the rights to
          any inputs you provide.
        </p>
      </LegalSection>

      <LegalSection heading="Disclaimer & liability">
        <p>
          The service is provided &ldquo;as is&rdquo; without warranties of any kind. To the maximum
          extent permitted by law, Pixovid is not liable for any indirect or consequential
          damages arising from your use of the service.
        </p>
      </LegalSection>

      <LegalSection heading="Contact us">
        <p>
          Questions about these Terms? Email{" "}
          <a className="text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
