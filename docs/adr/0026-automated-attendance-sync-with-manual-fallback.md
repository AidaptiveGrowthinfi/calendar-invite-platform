# Automate attendance sync with manual import fallback

The MVP will include automated attendance sync for Zoom, Microsoft Teams, and Google Meet through provider-specific attendance adapters, with manual CSV or XLSX import retained as a fallback. Each campaign will have one meeting provider and meeting reference, and after the event the worker system will fetch attendance, match attendees back to invited contacts, and update analytics for attended, no-show, accepted-but-missed, declined, and no-response segments.
