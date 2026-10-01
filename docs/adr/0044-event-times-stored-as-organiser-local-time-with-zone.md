# Store event times as organiser local time with an IANA zone

Date: 2026-09-03
Closes: W9

A campaign's event time is defined by the organiser, in the organiser's
timezone. It is stored as a local wall-clock time together with an IANA
timezone identifier, not as a UTC instant:

    start_local   timestamp WITHOUT time zone
    end_local     timestamp WITHOUT time zone
    timezone      text, an IANA identifier such as 'Asia/Kolkata'

The reason is that a UTC instant is the wrong canonical form for a future
scheduled event. Timezone rules change: governments alter or abolish daylight
saving, and the tzdata database is updated accordingly. An event booked for
3pm local must remain at 3pm local when that happens. A stored UTC instant
would silently move to 2pm or 4pm. This is why iCalendar uses `DTSTART;TZID=`
and why the Google Calendar API takes `dateTime` and `timeZone` as a pair
rather than an instant. The existing v1 implementation already stores the two
separately and passes them through unchanged.

Any UTC value derived from these fields - for sorting, for scheduling, for
"starts in 3 hours" - is derived and recomputable, never authoritative, and is
recomputed rather than trusted after a tzdata update.

The distinction is general: instants are stored as `timestamptz`, and only the
event time is stored as local time plus zone. `created_at`, `updated_at`,
`sent_at`, `accepted_at`, and `cancelled_at` are instants - they record when
something actually happened - and remain `timestamptz`.

Recipient timezones are not stored. Google Calendar, Outlook, and Apple
Calendar render a zoned event in each viewer's own timezone. The platform does
not need to know where a contact is in order to show them the right local time.

Validation:

- The timezone must be a recognised IANA identifier, checked against
  `pg_timezone_names`. Deprecated aliases are normalised to their canonical
  form, for example `Asia/Calcutta` to `Asia/Kolkata`, so that two campaigns at
  the same real time are stored identically.
- A local time that does not exist in its zone is rejected. On a
  spring-forward day, 02:30 is not a time. This is rare and is a validation
  error rather than a silent correction.
- A local time that occurs twice, on a fall-back day, is accepted and resolved
  to the first occurrence, matching calendar client behaviour.

Left open deliberately: a campaign's send schedule - "begin sending at 9am" -
is interpreted in the organiser's timezone. Per-recipient send-time
optimisation would require a different model and is not in scope.
