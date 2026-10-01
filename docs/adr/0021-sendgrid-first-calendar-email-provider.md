# Use SendGrid as the first calendar email provider

We will implement SendGrid as the first provider for calendar email mode while keeping the code behind an email provider adapter interface. SendGrid has the required MVP capabilities for domain authentication, branded link setup, event webhooks, bounce and complaint handling, suppression signals, and high-volume email delivery; Mailgun and Brevo can be added later without changing the product model.

The SendGrid adapter will use organisation-scoped credentials or subusers where supported, attach only non-sensitive campaign correlation metadata, and verify signed event-webhook requests before recording them. It will expose provider health and webhook-lag information to Campaign Health rather than treating an accepted SendGrid request as proof of inbox placement.
