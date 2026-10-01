/**
 * The dashboard shell.
 *
 * ADR 0056 makes this a GREENFIELD build. `C:\growthInfi\Frontend` is a
 * tools-hub shell with a mock dashboard for a different product - no screen
 * calls an API, the route guards import an auth hook that does not exist, and
 * the vocabulary throughout is cold-email. Nothing from it runs here. What
 * carries over is the stack choice, the Tailwind palette if it is liked, and
 * the CSV column-mapping interaction as a sketch for ADR 0024's import.
 *
 * Every screen - campaign creation, audience import with mapping and rejection
 * review, mailbox connection, send plan approval, deliverability status,
 * attendance reporting - is E13, and E13 tracks the API contract in
 * `docs/spec/02-api.md`.
 */
export function App(): React.ReactElement {
  return (
    <main className="mx-auto max-w-2xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">Calendar Invite Campaigns</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Dashboard shell. Screens are built in E13 against{' '}
        <code className="rounded bg-neutral-100 px-1">docs/spec/02-api.md</code>.
      </p>
    </main>
  );
}
