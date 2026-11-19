import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { TopNav } from "@/components/maskan/TopNav";
import { useLanguage } from "@/lib/i18n/context";

/**
 * Maskan Privacy Policy (web + Android app).
 *
 * Every statement below describes behaviour that exists in this codebase and
 * the current production configuration (2026-11). Nothing here may promise a
 * capability that isn't implemented.
 *
 * Items wrapped in <ToConfirm> are legal / business decisions that have NOT
 * been made yet; they render as visible yellow markers. Before publishing:
 * resolve every <ToConfirm>, have the text legally reviewed, then set
 * POLICY_APPROVED = true (which removes the draft banner) and fill in
 * LAST_UPDATED. Update this file whenever data handling changes (e.g. real
 * payments, push notifications or a new AI/analytics provider are enabled).
 */
// Also gates publication: routes/privacy.tsx serves the generic "not published
// yet" notice instead of this draft while false.
export const POLICY_APPROVED = false;
const LAST_UPDATED = "[date of approval]";

function ToConfirm({ children }: { children: ReactNode }) {
  return (
    <mark
      className="rounded bg-warning/20 px-1 text-foreground"
      title="Decision required before publishing"
    >
      [To be confirmed: {children}]
    </mark>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="space-y-3">
      <h2 className="font-display text-xl font-bold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export function PrivacyPolicy() {
  const { lang } = useLanguage();

  return (
    <div className="min-h-screen bg-surface">
      <TopNav />
      <main className="container-page max-w-3xl py-12">
        <article
          dir="ltr"
          lang="en"
          className="space-y-8 rounded-2xl border border-border bg-card p-6 text-sm leading-relaxed shadow-card sm:p-8"
        >
          {!POLICY_APPROVED && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 p-4">
              <p className="font-semibold">Draft — pending legal review</p>
              <p className="mt-1 text-muted-foreground">
                This policy has not been approved yet. Highlighted items still need a decision.
              </p>
            </div>
          )}
          {lang === "ar" && (
            <p className="rounded-xl border border-border p-4" dir="rtl" lang="ar">
              النسخة العربية من سياسة الخصوصية قيد الإعداد.{" "}
              <ToConfirm>Arabic translation (legally reviewed)</ToConfirm>
            </p>
          )}

          <header className="space-y-2">
            <h1 className="font-display text-3xl font-bold tracking-tight">Privacy Policy</h1>
            <p className="text-muted-foreground">Last updated: {LAST_UPDATED}</p>
            <p>
              This policy explains what personal data Maskan collects when you use the Maskan
              Android app and the website at maskanai.com (including the partner portal), how we use
              it, who we share it with, and the choices you have — including how to delete your
              account.
            </p>
          </header>

          <Section id="who" title="1. Who we are">
            <p>
              Maskan is operated by{" "}
              <ToConfirm>
                legal entity name, commercial registration number and registered address
              </ToConfirm>
              . You can contact us about privacy at{" "}
              <ToConfirm>privacy contact email address</ToConfirm>.
            </p>
          </Section>

          <Section id="collect" title="2. Data we collect">
            <h3 className="font-semibold">Account details</h3>
            <p>
              Your email address and password when you register (passwords are stored only as a
              salted hash), and — if you provide them — your name and phone number.
            </p>

            <h3 className="font-semibold">Property search and preferences</h3>
            <p>
              Properties and searches you save, alert settings for saved searches, searches you run
              in the home finder, and property requests you create (for example budget, number of
              bedrooms, preferred areas, move-in date and any notes you write).
            </p>

            <h3 className="font-semibold">Enquiries, viewings, offers and reviews</h3>
            <p>
              When you contact a partner (a licensed agent, broker or owner listed on Maskan),
              request a viewing, make or respond to an offer, or write a review, we store what you
              submit — such as your contact details, the property, preferred times, offer amounts,
              messages exchanged with the partner, and your rating and review text.
            </p>

            <h3 className="font-semibold">Transactions and documents</h3>
            <p>
              If you proceed with a rental or purchase through the transaction workspace, we store
              the transaction details (property, agreed amount, progress and status) and any
              documents you upload. Documents you upload may include identity documents (for example
              a national ID or Iqama) and contracts. Documents are stored on our own servers and are
              only available to you, the partner handling that transaction, and authorised Maskan
              administrators.
            </p>

            <h3 className="font-semibold">Identity verification</h3>
            <p>
              You can submit an identity document reference number for verification. It is reviewed
              by Maskan administrators. Maskan does not currently connect to Nafath or any other
              government identity service.
            </p>

            <h3 className="font-semibold">Location</h3>
            <p>
              The Android app asks for location permission only while you are using it (never in the
              background). If you allow it, your device location is used on your device to suggest
              your nearest district and to centre the map. To show listings on the map, the app
              sends the map area being viewed — not your exact position — to our servers. We do not
              save your device location to your account. You can refuse or withdraw this permission
              at any time in your device settings and still use Maskan.
            </p>

            <h3 className="font-semibold">Devices and notifications</h3>
            <p>
              If you allow push notifications, we store a push notification token for your device,
              the device platform and your language so we can send notifications you have enabled.
              We also store your in-app notifications and notification preferences.
            </p>

            <h3 className="font-semibold">Usage information</h3>
            <p>
              We record events about how Maskan is used (for example which features are opened and
              which listings are viewed), linked to your account if you are signed in. Our servers
              also process technical data such as IP addresses to deliver the service and to protect
              it against abuse (for example limiting repeated sign-in attempts). Maskan does not use
              third-party advertising or analytics SDKs.
            </p>

            <h3 className="font-semibold">Payments</h3>
            <p>
              Online card payments are not currently enabled in Maskan, so we do not collect payment
              card details. We keep records of subscriptions and fees associated with your account.{" "}
              <ToConfirm>update this section before card payments are enabled</ToConfirm>
            </p>
          </Section>

          <Section id="use" title="3. How we use your data">
            <ul className="list-disc space-y-1 ps-5">
              <li>To create and secure your account and keep you signed in.</li>
              <li>To show listings, maps, area information and property recommendations.</li>
              <li>
                To pass your enquiries, viewing requests, offers and property requests to the
                relevant partners and manage the resulting transaction.
              </li>
              <li>To send notifications and alerts you have enabled.</li>
              <li>To provide AI-assisted features (see section 4).</li>
              <li>
                To review listings, partners and reported content, prevent fraud and abuse, and keep
                audit records of important actions.
              </li>
              <li>To understand how Maskan is used and improve it.</li>
              <li>To comply with legal obligations.</li>
            </ul>
            <p>
              <ToConfirm>
                legal basis for each purpose under the applicable data protection law (e.g. KSA
                PDPL)
              </ToConfirm>
            </p>
          </Section>

          <Section id="ai" title="4. AI-assisted features">
            <p>
              Some features — such as the AI advisor chat, creating a property request from a
              written description, and explanations of listings, offers and transactions — use
              Anthropic's Claude AI service. When you use them, the text you enter and relevant
              listing or transaction information are sent to Anthropic to generate the response. We
              keep a record that an AI feature was used (feature, time and usage statistics) but we
              do not store the text of AI advisor conversations on our servers.
            </p>
          </Section>

          <Section id="share" title="5. Who we share data with">
            <ul className="list-disc space-y-1 ps-5">
              <li>
                <strong>Partners</strong> you interact with receive the details needed to handle
                your enquiry, viewing, offer, property request or transaction — such as your name,
                phone number, email address and request details — and documents you upload to a
                shared transaction.
              </li>
              <li>
                <strong>Service providers</strong> that run parts of Maskan for us: our hosting
                provider <ToConfirm>hosting provider name and server location / country</ToConfirm>;
                Anthropic (AI features); Google (maps in the app and area data); and, for push
                notifications, Expo and Google Firebase Cloud Messaging.
              </li>
              <li>
                <strong>Authorities</strong> where required by law or to protect the rights and
                safety of users and Maskan.
              </li>
            </ul>
            <p>
              We do not sell your personal data and we do not share it for advertising. When you
              choose to contact a partner by WhatsApp or phone, that communication happens outside
              Maskan and is subject to those services' own policies.
            </p>
            <p>
              <ToConfirm>
                whether any of these providers process data outside Saudi Arabia, and the safeguards
                relied on for cross-border transfers
              </ToConfirm>
            </p>
          </Section>

          <Section id="security" title="6. Security">
            <p>
              Connections to Maskan are encrypted with HTTPS. Passwords are stored as salted hashes,
              sign-in sessions on the app are kept in the device's secure storage, uploaded
              documents are not publicly accessible and are served only to authorised users, and
              access to administrative functions is restricted. No system is completely secure, and
              we cannot guarantee absolute security.
            </p>
          </Section>

          <Section id="retention" title="7. How long we keep data">
            <ul className="list-disc space-y-1 ps-5">
              <li>
                Account and preference data is kept while your account is active and deleted or
                anonymised when you delete your account (section 8).
              </li>
              <li>In-app notifications are deleted automatically after 180 days.</li>
              <li>
                Transactions, bookings, contracts, payments and their documents are kept after
                account deletion for legal, tax and dispute-resolution purposes for{" "}
                <ToConfirm>retention period(s)</ToConfirm>.
              </li>
              <li>
                Server backups are kept for <ToConfirm>backup retention period</ToConfirm> and then
                overwritten.
              </li>
            </ul>
          </Section>

          <Section id="delete" title="8. Deleting your account">
            <p>
              You can delete your account at any time in the Android app (
              <em>Profile → Delete account</em>) or on the web at{" "}
              <Link to="/account/delete" className="font-semibold text-primary hover:underline">
                maskanai.com/account/delete
              </Link>
              . You will need to confirm with your password.
            </p>
            <p>When you delete your account:</p>
            <ul className="list-disc space-y-1 ps-5">
              <li>You are signed out on every device and can no longer sign in to that account.</li>
              <li>
                <strong>Deleted:</strong> your name, email address and phone number on your profile,
                saved properties and searches, home-finder search history, notifications and
                notification settings, registered devices, and financing enquiries.
              </li>
              <li>
                <strong>Anonymised:</strong> your contact details on past enquiries to partners;
                your name on reviews you wrote (the rating and text remain visible without your
                name); usage and AI-usage records are kept without a link to you.
              </li>
              <li>
                <strong>Kept:</strong> completed or cancelled transactions, bookings, contracts,
                payments, offers, viewings and the documents attached to them, as described in
                section 7. Where such records exist, we keep a minimal record of your name and
                contact details, accessible only to authorised administrators, so they remain
                attributable. <ToConfirm>confirm this retention with legal counsel</ToConfirm>
              </li>
            </ul>
            <p>
              You can't delete your account while you have something in progress — for example an
              active transaction, an open offer, an upcoming viewing or booking, an open enquiry or
              an active property request. The deletion screen tells you what needs to be closed
              first. Partner (agent/broker) accounts are deleted through Maskan support.
            </p>
          </Section>

          <Section id="rights" title="9. Your choices and rights">
            <p>
              You can view and update your account details in the app or on the website, change
              notification settings, withdraw location or notification permission in your device
              settings, and delete your account as described above. To ask for a copy of your data
              or for any other request, contact us at{" "}
              <ToConfirm>privacy contact email address</ToConfirm>.{" "}
              <ToConfirm>statement of rights under the applicable law and response time</ToConfirm>
            </p>
          </Section>

          <Section id="children" title="10. Children">
            <p>
              Maskan is not intended for children. <ToConfirm>minimum age</ToConfirm>
            </p>
          </Section>

          <Section id="changes" title="11. Changes to this policy">
            <p>
              We will update this page when our data practices change and change the “Last updated”
              date above.
              <ToConfirm>whether and how users are notified of material changes</ToConfirm>
            </p>
          </Section>
        </article>
      </main>
    </div>
  );
}
