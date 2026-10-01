# Record ADR status, date, and supersession

Date: 2026-09-03
Closes: W13

ADRs 0001 to 0040 carry no status, date, context, or consequences, and the
revision pass of 2026-08-27 rewrote nine of them in place. What those ADRs said
before, and why they changed, is unrecoverable. That record is the main reason
to keep architecture decision records at all, so the format is fixed here.

From ADR 0041 onward, each ADR carries a short header naming its date and, where
applicable, what it supersedes, what supersedes it, and which review findings it
closes. ADRs 0042 to 0053 already follow this.

A decision that changes is not edited. A new ADR is written that supersedes the
old one, and the superseded ADR receives a pointer to its replacement and is
otherwise left as written. ADR 0007 and ADR 0004 are the first two handled this
way. The pointer is the only permitted in-place edit, along with correcting a
typographical error that does not change meaning.

Existing ADRs 0001 to 0040 are not retrofitted. Backdating a status onto a
document whose history was already lost would manufacture a record rather than
preserve one. They stand as they are, and the convention applies going forward.

The full context and consequences structure of a formal ADR template is not
adopted. These records are deliberately short, one to a few paragraphs, and the
brevity is why they exist for as many decisions as they do.
