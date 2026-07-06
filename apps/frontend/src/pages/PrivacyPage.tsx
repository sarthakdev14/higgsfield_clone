import { LegalPage, LegalSection } from "@/components/LegalPage";

const CONTACT_EMAIL = "harkirat.iitr@gmail.com";

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="June 30, 2026">
      <p className="text-sm leading-7 text-muted-foreground">
        Pixovid (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) is committed to
        protecting your privacy. This Privacy Policy explains what information we collect, how we
        use it, and the choices you have. By using our website and services you agree to the
        practices described below.
      </p>

      <LegalSection heading="Information we collect">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Account information:</strong> your name, email address, and authentication
            details when you sign up (including via Google sign-in).
          </li>
          <li>
            <strong>Content you provide:</strong> prompts, uploaded photos/images, reference media,
            avatars, and the videos or images you generate.
          </li>
          <li>
            <strong>Payment information:</strong> processed securely by our payment provider
            (Razorpay). We do not store your full card details on our servers.
          </li>
          <li>
            <strong>Usage data:</strong> basic technical information such as device, browser, and
            interactions needed to operate and improve the service.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="How we use your information">
        <ul className="list-disc space-y-1 pl-5">
          <li>To provide, operate, and maintain the service, including generating your media.</li>
          <li>To process payments and manage your credits and account.</li>
          <li>To communicate with you about your account, support requests, and updates.</li>
          <li>To detect, prevent, and address abuse, fraud, or security issues.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Third-party services">
        <p>
          We rely on trusted third parties to deliver the service, including AI model providers
          (e.g. OpenRouter) to generate media, object storage to host your files, and Razorpay to
          process payments. These providers process data only as needed to perform their services.
        </p>
      </LegalSection>

      <LegalSection heading="Data retention">
        <p>
          We retain your account information and generated content for as long as your account is
          active or as needed to provide the service. You may request deletion of your account and
          associated data at any time by contacting us.
        </p>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>
          You may access, update, or delete your personal information, and you may withdraw consent
          where processing is based on consent. To exercise these rights, contact us using the
          details below.
        </p>
      </LegalSection>

      <LegalSection heading="Contact us">
        <p>
          If you have any questions about this Privacy Policy, email us at{" "}
          <a className="text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
