# Use non-SMTP email intelligence first

The MVP will verify recipient emails with a non-SMTP email intelligence layer by default, using syntax validation, normalization, DNS and MX checks, provider detection, disposable-domain checks, role-address detection, typo suggestions, suppression history, bounce history, and risk scoring. SMTP probing through the existing `mailVerify` service remains a second option for deeper verification, but it will not be required for the default import flow because it needs outbound port 25 and carries extra operational and reputation risk.
