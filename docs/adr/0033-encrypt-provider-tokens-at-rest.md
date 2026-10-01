# Encrypt provider tokens at rest

OAuth refresh tokens and provider credentials for Google, Microsoft, Zoom, Teams, Google Meet, SendGrid, Razorpay, and future integrations will be encrypted before storage in PostgreSQL. The application will load encryption keys from server-side secrets, never log token material, audit connect and disconnect actions, and support token rotation or revocation; a managed KMS can replace the initial VPS secret approach later without changing the product model.
