# Freeze campaign membership at approval

Date: 2026-09-07
Refs: 0045, 0013, 0032, 0024

A campaign is one webinar. Two webinars have different event details, different
times, and different lists, and they must not interfere with each other. The
product owner stated this directly on 2026-09-07.

A campaign therefore does not reference a live audience. At approval it records
the set of contacts it will invite, and it sends to that set. Later imports into
the same audience do not change a campaign that has already been approved.

The case that decides it is a multi-day send, which is the normal case under
ADR 0047's 50,000-contact target. A plan approved on Monday runs to Friday. If
the campaign referenced the audience, an import on Wednesday for a different
webinar would enlarge Thursday's batch: contacts would be invited who were never
in the approved plan, and the capacity computed at approval would be wrong for
the days that remain.

ADR 0045 already requires that an approved send plan is immutable, versioned,
and audit evidence for "which mailbox was to send to whom, and when". A live
reference makes that plan immutable in name only, because its recipient set
would change underneath it. Freezing membership is what makes 0045 true rather
than aspirational.

Consequences:

- Adding contacts to an approved campaign is an explicit operation that
  produces a new plan version with its own capacity computation and its own
  approval, exactly as a reschedule does under 0045. It is never a side effect
  of an audience import.
- An audience remains reusable. Two campaigns may freeze the same audience at
  different times and each keeps the membership it was approved with.
- The frozen set is the campaign's own table, written once at approval. The
  audience reference is retained for provenance, not for membership.
- Suppression is NOT frozen with the membership. It is evaluated at send time
  as well, because a contact who unsubscribes on Tuesday must not be sent to on
  Thursday. Freezing determines who was planned; suppression retains its veto
  right up to the provider call, per ADR 0039.
