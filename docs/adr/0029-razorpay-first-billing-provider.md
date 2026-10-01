# Use Razorpay as the first billing provider

We will use Razorpay as the first billing provider for the MVP because the business is India-based and Razorpay is a better default for Indian payment methods, subscriptions, payment links, and local onboarding. Billing will be implemented behind a provider adapter so Stripe or another provider can be added later for international expansion, but Stripe will not be the MVP default because India access is invite-only and less predictable for initial launch.
