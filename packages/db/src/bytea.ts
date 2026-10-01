/**
 * `bytea`, as a Drizzle column type.
 *
 * `spec/00-overview.md` makes this a cross-cutting rule with the reason
 * attached: encrypted material is `bytea`, never `text`, so it cannot be
 * logged as a string by accident. A `text` column holding base64 survives
 * `JSON.stringify` on a row and lands in a log line; a Buffer does not.
 *
 * Every encrypted column in the schema uses this type. `platform/crypto` is
 * the only thing that produces or consumes the contents.
 */
import { customType } from 'drizzle-orm/pg-core';

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});
